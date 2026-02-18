import React, { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useChartHydration } from '@/hooks/useChartHydration.jsx'

export default function Article() {
  const { slug } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
        console.error('Error fetching article:', err)
        setError(err.message)
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
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading article...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">📄</div>
          <h1 className="font-heading text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Article Not Found
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            The article you're looking for doesn't exist or has been removed.
          </p>
          <a 
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline"
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

  const articleContentRef = useRef(null)

  // Hydrate charts after article renders
  useChartHydration(articleContentRef, [article])

  // Format date
  const date = new Date(article.meta.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <article className="max-w-[680px] mx-auto px-6 py-12 lg:py-16">
        <header className="mb-12">
          <h1 className="font-heading text-4xl lg:text-5xl font-bold leading-tight text-gray-900 dark:text-gray-100 mb-4">
            {article.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
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

        <footer className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-700">
          <div className="text-center">
            <a 
              href="/" 
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
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