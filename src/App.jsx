import React, { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import Upload from './pages/Upload'
import Article from './pages/Article'

// Import highlight.js styles
import 'highlight.js/styles/github.css'
import 'highlight.js/styles/github-dark.css'

function App() {
  // Apply dark mode based on system preference
  useEffect(() => {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (isDark) {
      document.documentElement.classList.add('dark')
    }

    // Listen for changes to system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e) => {
      if (e.matches) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/:slug" element={<Article />} />
        </Routes>
        <Toaster 
          position="top-right"
          expand={false}
          richColors
          toastOptions={{
            duration: 4000,
          }}
        />
      </div>
    </Router>
  )
}

export default App