import React, { useState, useRef } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { render, extractTitle, generateSlug } from "@/lib/markdown"
import { toast } from "sonner"

export default function Upload() {
  const [markdown, setMarkdown] = useState('')
  const [slug, setSlug] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

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
    setDragOver(false)
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
        setPublishedUrl(`${window.location.origin}${data.url}`)
        toast.success('Article published successfully!')
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

  const visitArticle = () => {
    window.open(publishedUrl, '_blank')
  }

  const resetForm = () => {
    setMarkdown('')
    setSlug('')
    setPublishedUrl('')
    setShowPreview(false)
  }

  return (
    <div className="upload-container">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="font-heading text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            mdpage
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            One markdown file → one beautiful page
          </p>
        </div>

        {publishedUrl ? (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-green-600 dark:text-green-400 flex items-center gap-2">
                🎉 Published Successfully!
              </CardTitle>
              <CardDescription>
                Your article is now live at:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md mb-4 break-all">
                <code className="text-blue-600 dark:text-blue-400">{publishedUrl}</code>
              </div>
              <div className="flex gap-2">
                <Button onClick={copyUrl} variant="outline">
                  Copy URL
                </Button>
                <Button onClick={visitArticle}>
                  Visit Article
                </Button>
                <Button onClick={resetForm} variant="outline">
                  Create Another
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handlePublish} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Drop your file or paste markdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label
                    className={`drop-zone block ${dragOver ? 'drag-over' : ''}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    htmlFor="fileInput"
                  >
                    <div className="text-4xl mb-4">📄</div>
                    <div className="text-lg mb-2">
                      Drag and drop a .md file here, or click to select
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      id="fileInput"
                      accept=".md,.markdown,.txt"
                      className="hidden"
                      onChange={(e) => handleFileChange(e.target.files[0])}
                    />
                  </label>
                </div>

                <div>
                  <Label htmlFor="markdown">Or paste your markdown here</Label>
                  <Textarea
                    id="markdown"
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    placeholder="# Your Article Title

Write your markdown here..."
                    className="min-h-[300px] font-mono text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="slug">URL Slug (optional)</Label>
                  <Input
                    id="slug"
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="my-awesome-article (auto-generated from title if empty)"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Only letters, numbers, and hyphens allowed
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setShowPreview(!showPreview)}
                disabled={!markdown.trim()}
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </Button>
              <Button 
                type="submit" 
                disabled={isPublishing || !markdown.trim()}
              >
                {isPublishing ? 'Publishing...' : 'Publish Article'}
              </Button>
            </div>

            {showPreview && markdown.trim() && (
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div 
                    className="article-prose"
                    dangerouslySetInnerHTML={{ __html: render(markdown) }}
                  />
                </CardContent>
              </Card>
            )}
          </form>
        )}
      </div>
    </div>
  )
}