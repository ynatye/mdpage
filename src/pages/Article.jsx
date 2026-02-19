import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useChartHydration } from '@/hooks/useChartHydration.jsx'
import AdSlot from '@/components/AdSlot'
import AtRiskBanner from '@/components/AtRiskBanner'
import LifecycleStatusBar from '@/components/LifecycleStatusBar'

// ── Visitor identity ────────────────────────────────────────────────────────
// We store a stable UUID in localStorage so the server can deduplicate views
// from the same browser across sessions without relying on IP alone.
function getOrCreateVisitorId() {
  const KEY = 'mdpage_visitor_id'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private browsing or storage blocked — fall back to session-scoped id.
    return crypto.randomUUID()
  }
}

// Helper: upsert a <meta> tag by attribute/value pair.
function setMetaTag(attribute, value, content) {
  let tag = document.querySelector(`meta[${attribute}="${value}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attribute, value)
    document.head.appendChild(tag)
  }
  tag.content = content
}

// Format an ISO date string to a human-readable date.
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ── Derived helpers ────────────────────────────────────────────────────────

/**
 * Returns true if the article should show ads.
 * Defensive: if tier/adEnabled fields are absent, falls back to false
 * (no ads shown rather than accidental ads on a paid post).
 */
function shouldShowAds(meta) {
  if (!meta) return false
  // Explicit adEnabled flag takes precedence when present.
  if (typeof meta.adEnabled === 'boolean') return meta.adEnabled
  // Fall back to tier if adEnabled not yet persisted by backend.
  return meta.tier === 'free'
}

/**
 * Returns true if the article is at risk of expiry.
 */
function isAtRisk(meta) {
  if (!meta) return false
  return meta.status === 'at_risk'
}

/**
 * Returns true if the article has expired.
 */
function isExpired(meta) {
  if (!meta) return false
  return meta.status === 'expired'
}

/**
 * Fire-and-forget view tracking. Uses keepalive to avoid drops during
 * navigation/unload; failures are intentionally ignored.
 */
function trackView(slug) {
  const visitorId = getOrCreateVisitorId()
  fetch(`/api/articles/${slug}/view`, {
    method: 'POST',
    headers: { 'X-Visitor-Id': visitorId },
    keepalive: true,
  }).catch(() => {
    // Never impact article rendering for telemetry errors.
  })
}

// ── Expired post page ──────────────────────────────────────────────────────

function ExpiredPage({ title }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div
        className="text-center max-w-md mx-auto px-4"
        style={{ fontFamily: 'Geist Mono, monospace' }}
      >
        <div className="text-6xl mb-6">📭</div>
        <h1 className="text-2xl font-bold mb-3 text-foreground">
          {title ? `"${title}" Has Expired` : 'This Post Has Expired'}
        </h1>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          This free post didn't receive enough traffic to remain active and has
          been archived.
        </p>
        <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
          Free posts expire after 30 days with low traffic. Paid posts are kept
          permanently and are ad-free with a clean slug.
        </p>
        <a
          href="/"
          className="inline-block rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Publish a new post
        </a>
        <div className="mt-4">
          <a
            href="/"
            className="text-xs text-muted-foreground hover:opacity-70 underline underline-offset-2"
          >
            Learn about Paid posts →
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Main Article component ─────────────────────────────────────────────────

export default function Article() {
  const { slug } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Tracks an expired article title so ExpiredPage can show it.
  const [expiredTitle, setExpiredTitle] = useState(null)
  // True when the API explicitly returned 410 / status:expired.
  const [articleExpired, setArticleExpired] = useState(false)
  const articleContentRef = useRef(null)
  const trackedSlugRef = useRef(null)

  useChartHydration(articleContentRef, [article])

  useEffect(() => {
    if (!slug) return

    // New slug route → allow tracking once for this slug.
    trackedSlugRef.current = null

    let cancelled = false

    const fetchArticle = async () => {
      setLoading(true)
      setError(null)
      setArticleExpired(false)
      setExpiredTitle(null)

      try {
        const response = await fetch(`/api/articles/${slug}`)

        // ── Issue #9: Handle expired responses ────────────────────────────
        // Backend may return 410 Gone for expired posts with a JSON body,
        // or 200 with status:'expired'. Both are handled gracefully.
        if (response.status === 410) {
          const data = await response.json().catch(() => ({}))
          if (!cancelled) {
            setExpiredTitle(data.title ?? null)
            setArticleExpired(true)
            document.title = 'Expired Post — mdpage'
            setLoading(false)
          }
          return
        }

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Article not found')
        }

        const data = await response.json()
        if (cancelled) return

        // ── Issue #9: 200 response with status:'expired' ──────────────────
        if (data.meta?.status === 'expired' || isExpired(data.meta)) {
          setExpiredTitle(data.title ?? null)
          setArticleExpired(true)
          document.title = 'Expired Post — mdpage'
          setLoading(false)
          return
        }

        setArticle(data)

        // Update page title
        document.title = `${data.title} — mdpage`

        // Standard meta
        setMetaTag('name', 'description', data.meta.description)

        // Open Graph
        setMetaTag('property', 'og:title', data.title)
        setMetaTag('property', 'og:description', data.meta.description)
        setMetaTag('property', 'og:type', 'article')
        setMetaTag('property', 'og:url', window.location.href)

        // Twitter Card
        setMetaTag('name', 'twitter:card', 'summary_large_image')
        setMetaTag('name', 'twitter:title', data.title)
        setMetaTag('name', 'twitter:description', data.meta.description)

        // ── View tracking ─────────────────────────────────────────────────
        // Track once per slug render path (StrictMode/dev-safe).
        if (trackedSlugRef.current !== slug) {
          trackedSlugRef.current = slug
          trackView(slug)
        }
      } catch (err) {
        if (cancelled) return
        console.error('Error fetching article:', err)

        let message = 'Article not found'
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          message = 'Unable to connect to server'
        } else if (err.message) {
          message = err.message
        }
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchArticle()
    return () => {
      cancelled = true
    }
  }, [slug])

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div
            className="h-10 w-10 border-2 border-t-transparent border-primary animate-spin mx-auto mb-4"
            role="status"
            aria-label="Loading"
          />
          <p
            className="text-sm text-muted-foreground"
            style={{ fontFamily: 'Geist Mono, monospace' }}
          >
            Loading…
          </p>
        </div>
      </div>
    )
  }

  // ── Issue #9: Expired state ────────────────────────────────────────────────
  if (articleExpired) {
    return <ExpiredPage title={expiredTitle} />
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div
          className="text-center max-w-md mx-auto px-4"
          style={{ fontFamily: 'Geist Mono, monospace' }}
        >
          <div className="text-6xl mb-6">📄</div>
          <h1 className="text-2xl font-bold mb-3 text-foreground">Article Not Found</h1>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            {error === 'Article not found'
              ? "The article you're looking for doesn't exist or has been removed."
              : error}
          </p>
          <a
            href="/"
            className="text-primary hover:opacity-70 text-sm underline underline-offset-2"
          >
            ← Back to mdpage
          </a>
        </div>
      </div>
    )
  }

  if (!article) return null

  // ── Derived flags (Issue #5, #8) ──────────────────────────────────────────
  const showAds = shouldShowAds(article.meta)
  const atRisk = isAtRisk(article.meta)

  // ── Article ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <article className="max-w-[680px] mx-auto px-6 py-12 lg:py-16">

        {/* ── Issue #8: At-risk banner ─────────────────────────────────────── */}
        {atRisk && (
          <AtRiskBanner
            expiresAt={article.meta.expiresAt}
            daysLeft={article.lifecycleUx?.daysLeft}
            daysLeftText={article.lifecycleUx?.daysLeftText}
            urgency={article.lifecycleUx?.urgency}
            upgradeHref="/"
          />
        )}

        {/* ── Issue #5: Top ad slot (free posts only) ──────────────────────── */}
        {showAds && <AdSlot variant="banner" label="Advertisement" />}

        <header className="mb-12">
          <h1
            className="text-4xl lg:text-5xl font-bold leading-tight mb-4 text-foreground"
            style={{ fontFamily: 'Geist Mono, monospace' }}
          >
            {article.title}
          </h1>
          <div
            className="flex items-center gap-4 text-sm text-muted-foreground"
            style={{ fontFamily: 'Geist Mono, monospace' }}
          >
            <time dateTime={article.meta.createdAt}>{formatDate(article.meta.createdAt)}</time>
            <span aria-hidden>•</span>
            <span>{article.meta.readingTime}</span>
            {/* Tier badge — subtle, informational */}
            {article.meta.tier === 'free' && (
              <>
                <span aria-hidden>•</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground/70"
                  title="This is a free post. It is ad-supported and expires if traffic drops."
                >
                  free
                </span>
              </>
            )}
          </div>
        </header>

        {/* ── Issue #5: In-article ad (free posts, before main content) ────── */}
        {showAds && <AdSlot variant="inline" label="Sponsored" />}

        <div
          ref={articleContentRef}
          className="article-prose"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />

        {/* ── Issue #5: Footer ad slot (free posts only) ───────────────────── */}
        {showAds && <AdSlot variant="banner" label="Advertisement" />}

        <footer className="mt-16 pt-8 border-t border-border space-y-4">
          {/* Lifecycle status bar — only for free posts */}
          <LifecycleStatusBar
            tier={article.meta.tier}
            status={article.meta.status}
            lifecycleUx={article.lifecycleUx}
            upgradeHref="/"
          />
          <div className="text-center">
            <a
              href="/"
              className="text-sm text-muted-foreground hover:opacity-70 transition-opacity"
              style={{ fontFamily: 'Geist Mono, monospace' }}
              title="Create your own beautiful articles"
            >
              powered by mdpage
            </a>
          </div>
        </footer>
      </article>

      {/* Structured data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: article.title,
            description: article.meta.description,
            datePublished: article.meta.createdAt,
            author: { '@type': 'Person', name: 'Author' },
          }),
        }}
      />
    </div>
  )
}
