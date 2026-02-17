const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { render, renderContent, extractTitle, generateSlug, extractDescription, estimateReadingTime } = require('./lib/markdown');

const app = express();
const PORT = 3456;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

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

// GET / - Upload page
app.get('/', async (req, res) => {
  try {
    const html = await fs.readFile('./views/upload.html', 'utf8');
    res.send(html);
  } catch (error) {
    res.status(500).send('Error loading upload page');
  }
});

// POST /publish - Publish article
app.post('/publish', async (req, res) => {
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

    // Check for slug collision
    const index = await loadIndex();
    if (index[slug]) {
      return res.status(409).json({ 
        error: 'An article with this URL already exists',
        suggestion: 'Try using a different custom slug or modify the title'
      });
    }

    // Extract metadata
    const description = extractDescription(markdown);
    const readingTime = estimateReadingTime(markdown);
    const createdAt = new Date().toISOString();

    // Save markdown file
    const articlePath = path.join('./data/articles', `${slug}.md`);
    await fs.writeFile(articlePath, markdown, 'utf8');

    // Update index
    index[slug] = {
      slug,
      title,
      description,
      createdAt,
      readingTime
    };
    await saveIndex(index);

    res.json({ 
      success: true, 
      slug, 
      title,
      url: `/${slug}` 
    });

  } catch (error) {
    console.error('Publish error:', error);
    
    // More specific error messages
    if (error.code === 'ENOSPC') {
      return res.status(507).json({ error: 'Server storage full' });
    }
    if (error.code === 'EACCES') {
      return res.status(500).json({ error: 'Server permission error' });
    }
    
    res.status(500).json({ error: 'Failed to publish article' });
  }
});

// GET /:slug - View article
app.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Validate slug format
    if (!slug || !slug.match(/^[a-z0-9-]+$/)) {
      return res.status(404).send('Article not found');
    }
    
    // Load article metadata
    const index = await loadIndex();
    const article = index[slug];
    
    if (!article) {
      return res.status(404).send('Article not found');
    }

    // Load article content
    const articlePath = path.join('./data/articles', `${slug}.md`);
    let markdown;
    try {
      markdown = await fs.readFile(articlePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).send('Article content not found');
      }
      throw error;
    }
    
    // Render content (strips first H1 to avoid duplication with header)
    const content = renderContent(markdown);
    
    // Load template
    let template;
    try {
      template = await fs.readFile('./views/article.html', 'utf8');
    } catch (error) {
      console.error('Template loading error:', error);
      return res.status(500).send('Template error');
    }
    
    // Format date
    const date = new Date(article.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Escape content for HTML (prevent XSS from title/description)
    const escapeHtml = (text) => text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Replace template variables
    const html = template
      .replace(/{{title}}/g, escapeHtml(article.title))
      .replace(/{{description}}/g, escapeHtml(article.description))
      .replace(/{{content}}/g, content)
      .replace(/{{date}}/g, escapeHtml(date))
      .replace(/{{readingTime}}/g, escapeHtml(article.readingTime));

    res.send(html);

  } catch (error) {
    console.error('Article view error:', error);
    res.status(500).send('Error loading article');
  }
});

// Start server
async function start() {
  await ensureDataDirs();
  app.listen(PORT, () => {
    console.log(`mdpage server running at http://localhost:${PORT}`);
  });
}

start().catch(console.error);