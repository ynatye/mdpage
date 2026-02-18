import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { render, extractTitle, generateSlug } from '@/lib/markdown'
import { useChartHydration } from '@/hooks/useChartHydration.jsx'
import { toast } from 'sonner'
import MdpageLogo from '@/components/MdpageLogo'

export default function Upload() {
  const [markdown, setMarkdown] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false) // true once user edits the slug field
  const [renderedHTML, setRenderedHTML] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [mobileView, setMobileView] = useState('editor')
  const [isMobile, setIsMobile] = useState(false)

  const fileInputRef = useRef(null)
  const editorRef = useRef(null)
  const previewRef = useRef(null)
  const debounceTimer = useRef(null)

  // ── Preview rendering (debounced) ──────────────────────────────────────────
  const updatePreview = useCallback((content) => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setRenderedHTML(content.trim() ? render(content) : '')
    }, 150)
  }, [])

  useEffect(() => {
    updatePreview(markdown)
  }, [markdown, updatePreview])

  // ── Slug auto-generation from title (only when user hasn't overridden it) ──
  useEffect(() => {
    if (slugManual) return
    if (!markdown) return
    const title = extractTitle(markdown)
    if (title && title !== 'Untitled') {
      setSlug(generateSlug(title))
    }
  }, [markdown, slugManual])

  // ── Chart hydration after preview renders ──────────────────────────────────
  useChartHydration(previewRef, [renderedHTML])

  // ── Mobile breakpoint detection ────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── File handling ──────────────────────────────────────────────────────────
  const loadFile = (file) => {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['md', 'markdown', 'txt'].includes(ext)) {
      toast.error('Please select a .md, .markdown, or .txt file')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => setMarkdown(e.target.result)
    reader.onerror = () => toast.error('Failed to read file')
    reader.readAsText(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) loadFile(files[0])
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    if (!editorRef.current?.contains(e.relatedTarget)) {
      setDragOver(false)
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  const handlePublish = async (e) => {
    e.preventDefault()

    if (!markdown.trim()) {
      toast.error('Please enter some markdown content')
      return
    }

    const title = extractTitle(markdown)
    if (!title || title === 'Untitled') {
      toast.error('Article must have a title (first line starting with "# ")')
      return
    }

    setIsPublishing(true)

    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: markdown.trim(),
          slug: slug.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        const fullUrl = `${window.location.origin}${data.url}`
        setPublishedUrl(fullUrl)
        toast.success(data.updated ? 'Article updated!' : 'Article published!', {
          action: {
            label: 'Copy URL',
            onClick: () => {
              navigator.clipboard.writeText(fullUrl)
              toast.success('URL copied!')
            },
          },
        })
      } else {
        let msg = data.error || 'Failed to publish article'
        if (data.suggestion) msg += ' ' + data.suggestion
        toast.error(msg)
      }
    } catch (err) {
      console.error('Publish error:', err)
      const msg =
        err.name === 'TypeError' && err.message.includes('fetch')
          ? 'Network error: unable to connect to server'
          : err.name === 'AbortError'
          ? 'Request timed out — please try again'
          : 'Failed to publish article'
      toast.error(msg)
    } finally {
      setIsPublishing(false)
    }
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(publishedUrl)
    toast.success('URL copied!')
  }

  const openArticle = () => window.open(publishedUrl, '_blank')

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <MdpageLogo className="h-8 w-auto text-foreground select-none" />

        <div className="flex items-center gap-4 flex-1 max-w-md mx-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-muted-foreground shrink-0">mdpage.com/</span>
            <Input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugManual(true)
              }}
              placeholder="article-slug"
              className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm min-w-0"
            />
          </div>

          {publishedUrl && (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={copyUrl} className="h-7 px-2 text-xs">
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={openArticle} className="h-7 px-2 text-xs">
                Open
              </Button>
            </div>
          )}
        </div>

        <Button
          onClick={handlePublish}
          disabled={isPublishing || !markdown.trim()}
          className="shrink-0"
        >
          {isPublishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>

      {/* ── Mobile tabs ── */}
      {isMobile && (
        <div className="flex border-b border-border">
          {['editor', 'preview'].map((view) => (
            <button
              key={view}
              onClick={() => setMobileView(view)}
              className={`flex-1 py-3 px-4 text-sm font-medium capitalize ${
                mobileView === view
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {/* ── Editor + Preview ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor panel */}
        <div
          className={`${
            isMobile ? (mobileView === 'editor' ? 'flex' : 'hidden') : 'flex'
          } flex-1 flex-col min-w-0`}
        >
          <div
            ref={editorRef}
            className="flex-1 relative"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={`# Your Article Title\n\nStart writing your markdown here…\n\nDrag and drop a .md file, or click the area below to upload.`}
              className={`w-full h-full resize-none border-0 bg-transparent p-6 text-sm font-mono leading-relaxed focus-visible:outline-none focus-visible:ring-0 transition-colors ${
                dragOver ? 'opacity-30' : ''
              }`}
              style={{ fontFamily: 'Geist Mono, monospace' }}
            />

            {/* Drag overlay */}
            {dragOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/90">
                <div className="text-center pointer-events-none">
                  <div className="text-4xl mb-2">📄</div>
                  <div className="text-lg font-medium text-primary">Drop .md file here</div>
                </div>
              </div>
            )}

            {/* Click-to-upload strip (bottom of editor) */}
            {!markdown && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 inset-x-0 py-3 text-xs text-muted-foreground hover:text-primary border-t border-dashed border-border hover:border-primary transition-colors bg-background text-center"
              >
                or click here to upload a file
              </button>
            )}
          </div>
        </div>

        {/* Divider (desktop only) */}
        {!isMobile && <div className="w-px bg-border flex-shrink-0" />}

        {/* Preview panel */}
        <div
          className={`${
            isMobile ? (mobileView === 'preview' ? 'flex' : 'hidden') : 'flex'
          } flex-1 flex-col min-w-0 bg-background`}
        >
          <div className="flex-1 overflow-auto">
            {renderedHTML ? (
              <div className="p-6">
                <div
                  ref={previewRef}
                  className="article-prose"
                  dangerouslySetInnerHTML={{ __html: renderedHTML }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground select-none">
                <div className="text-center">
                  <div className="text-4xl mb-4">👁️</div>
                  <div className="text-sm">Preview will appear here</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        className="hidden"
        onChange={(e) => loadFile(e.target.files[0])}
      />
    </div>
  )
}
