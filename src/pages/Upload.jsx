import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { render, extractTitle, generateSlug } from "@/lib/markdown"
import { toast } from "sonner"

export default function Upload() {
  const [markdown, setMarkdown] = useState('')
  const [slug, setSlug] = useState('')
  const [renderedHTML, setRenderedHTML] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [mobileView, setMobileView] = useState('editor') // 'editor' or 'preview'
  const [isMobile, setIsMobile] = useState(false)
  const fileInputRef = useRef(null)
  const editorRef = useRef(null)

  // Debounced preview rendering
  const debounceTimer = useRef(null)
  
  const updatePreview = useCallback((content) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      if (content.trim()) {
        setRenderedHTML(render(content))
      } else {
        setRenderedHTML('')
      }
    }, 150)
  }, [])

  // Auto-generate slug from title
  useEffect(() => {
    if (markdown) {
      const title = extractTitle(markdown)
      if (title && title !== 'Untitled' && !slug) {
        setSlug(generateSlug(title))
      }
      updatePreview(markdown)
    }
  }, [markdown, slug, updatePreview])

  // Detect mobile screen size
  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkIsMobile()
    window.addEventListener('resize', checkIsMobile)
    
    return () => window.removeEventListener('resize', checkIsMobile)
  }, [])

  const handleFileChange = (file) => {
    if (file && (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt'))) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setMarkdown(e.target.result)
      }
      reader.readAsText(file)
    } else {
      toast.error('Please select a .md, .markdown, or .txt file')
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      handleFileChange(files[0])
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    // Only set dragOver to false if we're leaving the editor area entirely
    if (!editorRef.current?.contains(e.relatedTarget)) {
      setDragOver(false)
    }
  }

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdown: markdown.trim(),
          slug: slug.trim() || undefined
        })
      })

      const data = await response.json()

      if (response.ok) {
        const fullUrl = `${window.location.origin}${data.url}`
        setPublishedUrl(fullUrl)
        toast.success('Article published successfully!', {
          action: {
            label: 'Copy URL',
            onClick: () => {
              navigator.clipboard.writeText(fullUrl)
              toast.success('URL copied to clipboard!')
            },
          },
        })
      } else {
        toast.error(data.error || 'Failed to publish article')
      }
    } catch (error) {
      console.error('Publish error:', error)
      toast.error('Failed to publish article')
    } finally {
      setIsPublishing(false)
    }
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(publishedUrl)
    toast.success('URL copied to clipboard!')
  }

  const openArticle = () => {
    window.open(publishedUrl, '_blank')
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="text-lg font-semibold text-foreground">
          mdpage
        </div>
        
        <div className="flex items-center gap-4 flex-1 max-w-md mx-4">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-sm text-muted-foreground">mdpage.com/</span>
            <Input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="article-slug"
              className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm"
            />
          </div>
          
          {publishedUrl && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={copyUrl}
                className="h-7 px-2 text-xs"
              >
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={openArticle}
                className="h-7 px-2 text-xs"
              >
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
          {isPublishing ? 'Publishing...' : 'Publish'}
        </Button>
      </div>

      {/* Mobile Toggle Tabs */}
      {isMobile && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setMobileView('editor')}
            className={`flex-1 py-3 px-4 text-sm font-medium ${
              mobileView === 'editor'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setMobileView('preview')}
            className={`flex-1 py-3 px-4 text-sm font-medium ${
              mobileView === 'preview'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Preview
          </button>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'flex-col' : ''}`}>
        {/* Editor Panel */}
        <div className={`${isMobile ? (mobileView === 'editor' ? 'flex' : 'hidden') : 'flex'} flex-1 flex-col min-w-0 relative`}>
          <div
            ref={editorRef}
            className={`flex-1 relative ${dragOver ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="# Your Article Title

Start writing your markdown here...

You can also drag and drop a .md file onto this editor."
              className="w-full h-full resize-none border-0 bg-transparent p-6 text-sm font-mono leading-relaxed focus-visible:outline-none focus-visible:ring-0"
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            />
            
            {/* Drag Overlay */}
            {dragOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-950/90 backdrop-blur-sm">
                <div className="text-center">
                  <div className="text-4xl mb-2">📄</div>
                  <div className="text-lg font-medium text-blue-700 dark:text-blue-300">
                    Drop .md file here
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Divider - only show on desktop */}
        {!isMobile && <div className="w-px bg-border flex-shrink-0"></div>}

        {/* Preview Panel */}
        <div className={`${isMobile ? (mobileView === 'preview' ? 'flex' : 'hidden') : 'flex'} flex-1 flex-col min-w-0 bg-background`}>
          <div className="flex-1 overflow-auto">
            {renderedHTML ? (
              <div className="p-6">
                <div 
                  className="article-prose"
                  dangerouslySetInnerHTML={{ __html: renderedHTML }}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <div className="text-4xl mb-4">👁️</div>
                  <div>Preview will appear here</div>
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
        onChange={(e) => handleFileChange(e.target.files[0])}
      />
    </div>
  )
}