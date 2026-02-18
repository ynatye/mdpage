import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { render, renderContent, extractTitle, generateSlug, extractDescription, estimateReadingTime } from './lib/markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3456;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware — only needed in development (proxied by Vite in dev, same origin in prod)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });
}

// Serve static files from dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Ensure data directories exist
async function ensureDataDirs() {
  try {
    await fs.access('./data');
  } catch {
    await fs.mkdir('./data', { recursive: true });
  }
  
  try {
    await fs.access('./data/articles');
  } catch {
    await fs.mkdir('./data/articles', { recursive: true });
  }
  
  try {
    await fs.access('./data/index.json');
  } catch {
    await fs.writeFile('./data/index.json', '{}');
  }
}

// Load index metadata
async function loadIndex() {
  try {
    const data = await fs.readFile('./data/index.json', 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save index metadata
async function saveIndex(index) {
  await fs.writeFile('./data/index.json', JSON.stringify(index, null, 2));
}

// Simple async mutex — serialises concurrent index.json reads/writes so that
// two simultaneous publish requests cannot interleave their load→mutate→save
// sequences and silently drop each other's changes.
let _indexLock = Promise.resolve();
async function withIndexLock(fn) {
  const prev = _indexLock;
  let release;
  _indexLock = new Promise((r) => { release = r; });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// API Routes
// POST /api/publish - Publish article
app.post('/api/publish', async (req, res) => {
  try {
    const { markdown, slug: customSlug } = req.body;
    
    // Validate input
    if (!markdown || typeof markdown !== 'string' || markdown.trim().length === 0) {
      return res.status(400).json({ error: 'Markdown content is required' });
    }

    if (markdown.trim().length > 1024 * 1024) { // 1MB limit
      return res.status(400).json({ error: 'Markdown content too large (max 1MB)' });
    }

    // Extract and validate title
    const title = extractTitle(markdown);
    if (!title || title === 'Untitled' || title.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Article must have a title (first line starting with "# ")' 
      });
    }

    // Generate and validate slug
    let slug;
    if (customSlug && customSlug.trim()) {
      slug = customSlug.trim().toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      if (!slug || slug.length === 0) {
        return res.status(400).json({ 
          error: 'Invalid custom slug. Use only letters, numbers, and hyphens.' 
        });
      }
    } else {
      slug = generateSlug(title);
      if (!slug || slug.length === 0) {
        return res.status(400).json({ error: 'Could not generate valid slug from title' });
      }
    }

    // Pre-compute metadata outside the lock (no I/O, safe to do here)
    const description = extractDescription(markdown);
    const readingTime = estimateReadingTime(markdown);

    // Write the markdown file before acquiring the index lock.
    // Two concurrent writes to the same slug will race at the OS level;
    // the last writer wins, which is acceptable (same-slug = same article).
    const articlePath = path.join('./data/articles', `${slug}.md`);
    await fs.writeFile(articlePath, markdown, 'utf8');

    // Serialise index load → mutate → save under a mutex so concurrent
    // publishes for *different* slugs cannot clobber each other's entries.
    let isUpdate;
    await withIndexLock(async () => {
      const index = await loadIndex();
      isUpdate = !!index[slug];

      const createdAt = isUpdate ? index[slug].createdAt : new Date().toISOString();
      const updatedAt = isUpdate ? new Date().toISOString() : undefined;

      index[slug] = {
        slug,
        title,
        description,
        ...(updatedAt && { updatedAt }),
        createdAt,
        readingTime,
      };
      await saveIndex(index);
    });

    res.json({ 
      success: true, 
      slug, 
      title,
      url: `/${slug}`,
      updated: isUpdate
    });

  } catch (error) {
    console.error('Publish error:', error);
    
    // More specific error messages
    if (error.code === 'ENOSPC') {
      return res.status(507).json({ 
        error: 'Server storage full', 
        details: 'The server has run out of disk space. Please try again later.' 
      });
    }
    if (error.code === 'EACCES') {
      return res.status(500).json({ 
        error: 'Server permission error', 
        details: 'The server does not have permission to write files.' 
      });
    }
    if (error.code === 'EMFILE' || error.code === 'ENFILE') {
      return res.status(500).json({ 
        error: 'Too many open files', 
        details: 'The server is handling too many requests. Please try again in a moment.' 
      });
    }
    
    // For development, include more error details
    const errorDetails = process.env.NODE_ENV === 'production' ? undefined : {
      message: error.message,
      stack: error.stack
    };
    
    res.status(500).json({ 
      error: 'Failed to publish article',
      details: 'An unexpected error occurred while publishing the article.',
      debug: errorDetails
    });
  }
});

// GET /api/articles/:slug - Get article data
app.get('/api/articles/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Validate slug format
    if (!slug || !slug.match(/^[a-z0-9-]+$/)) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Load article metadata
    const index = await loadIndex();
    const article = index[slug];
    
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Load article content
    const articlePath = path.join('./data/articles', `${slug}.md`);
    let markdown;
    try {
      markdown = await fs.readFile(articlePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Article content not found' });
      }
      throw error;
    }
    
    // Render content (strips first H1 to avoid duplication with header)
    const content = renderContent(markdown);
    
    res.json({
      title: article.title,
      content,
      meta: {
        slug: article.slug,
        description: article.description,
        createdAt: article.createdAt,
        readingTime: article.readingTime
      }
    });

  } catch (error) {
    console.error('Article API error:', error);
    res.status(500).json({ error: 'Error loading article' });
  }
});

// SPA fallback — serve the React app for all non-API routes
app.use((req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, 'dist') }, (err) => {
    if (err) {
      // dist/ not built yet or file missing — give a helpful message
      if (err.code === 'ENOENT') {
        res.status(503).send(
          '<h1>503 — App not built</h1><p>Run <code>npm run build</code> first.</p>'
        );
      } else {
        res.status(500).send('<h1>500 — Server error</h1>');
      }
    }
  });
});

// Start server
async function start() {
  await ensureDataDirs();
  app.listen(PORT, () => {
    console.log(`mdpage server running at http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log('Development: React app available at http://localhost:5173');
    }
  });
}

start().catch(console.error);