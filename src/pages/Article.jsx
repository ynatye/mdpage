import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useChartHydration } from '@/hooks/useChartHydration.jsx'

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

export default function Article() {
  const { slug } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const articleContentRef = useRef(null)

  useChartHydration(articleContentRef, [article])

  useEffect(() => {
    if (!slug) return

    let cancelled = false

    const fetchArticle = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/articles/${slug}`)

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Article not found')
        }

        const data = await response.json()
        if (cancelled) return

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
    return () => { cancelled = true }
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
          <p className="text-sm text-muted-foreground" style={{ fontFamily: 'Geist Mono, monospace' }}>
            Loading…
          </p>
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto px-4" style={{ fontFamily: 'Geist Mono, monospace' }}>
          <div className="text-6xl mb-6">📄</div>
          <h1 className="text-2xl font-bold mb-3 text-foreground">Article Not Found</h1>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            {error === 'Article not found'
              ? "The article you're looking for doesn't exist or has been removed."
              : error}
          </p>
          <a href="/" className="text-primary hover:opacity-70 text-sm underline underline-offset-2">
            ← Back to mdpage
          </a>
        </div>
      </div>
    )
  }

  if (!article) return null

  // ── Article ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <article className="max-w-[680px] mx-auto px-6 py-12 lg:py-16">
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
          </div>
        </header>

        <div
          ref={articleContentRef}
          className="article-prose"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />

        <footer className="mt-16 pt-8 border-t border-border">
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
