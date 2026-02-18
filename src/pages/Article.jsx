import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useChartHydration } from '@/hooks/useChartHydration.jsx'

export default function Article() {
  const { slug } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const articleContentRef = useRef(null)

  // Hydrate charts after article renders
  useChartHydration(articleContentRef, [article])

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        const response = await fetch(`/api/articles/${slug}`)
        
        if (!response.ok) {
          throw new Error('Article not found')
        }

        const data = await response.json()
        setArticle(data)

        // Update document title and meta tags
        document.title = data.title
        
        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]')
        if (metaDesc) {
          metaDesc.content = data.meta.description
        } else {
          const meta = document.createElement('meta')
          meta.name = 'description'
          meta.content = data.meta.description
          document.head.appendChild(meta)
        }

        // Update Open Graph tags
        updateMetaTag('property', 'og:title', data.title)
        updateMetaTag('property', 'og:description', data.meta.description)
        updateMetaTag('property', 'og:type', 'article')
        updateMetaTag('property', 'og:url', window.location.href)

        // Update Twitter Card tags
        updateMetaTag('name', 'twitter:card', 'summary_large_image')
        updateMetaTag('name', 'twitter:title', data.title)
        updateMetaTag('name', 'twitter:description', data.meta.description)

      } catch (err) {
        console.error('Error fetching article:', err);
        
        // Provide more specific error messages
        let errorMessage = 'Article not found';
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          errorMessage = 'Unable to connect to server';
        } else if (err.message) {
          errorMessage = err.message;
        }
        
        setError(errorMessage);
      } finally {
        setLoading(false)
      }
    }

    if (slug) {
      fetchArticle()
    }
  }, [slug])

  const updateMetaTag = (attribute, value, content) => {
    let tag = document.querySelector(`meta[${attribute}="${value}"]`)
    if (tag) {
      tag.content = content
    } else {
      tag = document.createElement('meta')
      tag.setAttribute(attribute, value)
      tag.content = content
      document.head.appendChild(tag)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'hsl(var(--background))' }}>
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: 'hsl(var(--primary))' }}></div>
          <p style={{ color: 'hsl(var(--muted-foreground))' }}>Loading article...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'hsl(var(--background))' }}>
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">📄</div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'hsl(var(--foreground))', fontFamily: 'Geist Mono, monospace' }}>
            Article Not Found
          </h1>
          <p className="mb-4" style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'Geist Mono, monospace' }}>
            The article you're looking for doesn't exist or has been removed.
          </p>
          <a 
            href="/"
            className="hover:underline"
            style={{ color: 'hsl(var(--primary))', fontFamily: 'Geist Mono, monospace' }}
          >
            ← Back to mdpage
          </a>
        </div>
      </div>
    )
  }

  if (!article) {
    return null
  }

  // Format date
  const date = new Date(article.meta.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'hsl(var(--background))' }}>
      <article className="max-w-[680px] mx-auto px-6 py-12 lg:py-16">
        <header className="mb-12">
          <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-4" style={{ color: 'hsl(var(--foreground))', fontFamily: 'Geist Mono, monospace' }}>
            {article.title}
          </h1>
          <div className="flex items-center gap-4 text-sm" style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'Geist Mono, monospace' }}>
            <time dateTime={article.meta.createdAt}>
              {date}
            </time>
            <span>•</span>
            <span>{article.meta.readingTime}</span>
          </div>
        </header>

        <div 
          ref={articleContentRef}
          className="article-prose"
          dangerouslySetInnerHTML={{ __html: article.content }}
        />

        <footer className="mt-16 pt-8 border-t" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="text-center">
            <a 
              href="/" 
              className="text-sm transition-colors hover:opacity-70"
              style={{ color: 'hsl(var(--muted-foreground))', fontFamily: 'Geist Mono, monospace' }}
              title="Create your own beautiful articles"
            >
              powered by mdpage
            </a>
          </div>
        </footer>
      </article>

      {/* Structured Data for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": article.title,
            "description": article.meta.description,
            "datePublished": article.meta.createdAt,
            "author": {
              "@type": "Person",
              "name": "Author"
            }
          })
        }}
      />
    </div>
  )
}