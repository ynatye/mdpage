import React, { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import Upload from './pages/Upload'
import Article from './pages/Article'

// Import highlight.js base theme — dark mode overrides are in index.css
import 'highlight.js/styles/github.css'

function App() {
  useEffect(() => {
    const applyTheme = (dark) => {
      document.documentElement.classList.toggle('dark', dark)
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyTheme(mq.matches)

    const handler = (e) => applyTheme(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Upload />} />
        <Route path="/:slug" element={<Article />} />
      </Routes>
      <Toaster
        position="top-right"
        expand={false}
        richColors
        toastOptions={{ duration: 4000 }}
      />
    </Router>
  )
}

export default App
