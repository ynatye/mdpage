const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { render, extractTitle, generateSlug, extractDescription, estimateReadingTime } = require('./lib/markdown');

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
    
    if (!markdown || markdown.trim().length === 0) {
      return res.status(400).json({ error: 'Markdown content is required' });
    }

    // Extract metadata
    const title = extractTitle(markdown);
    const slug = customSlug && customSlug.trim() 
      ? customSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      : generateSlug(title);
    
    if (!slug) {
      return res.status(400).json({ error: 'Could not generate valid slug' });
    }

    const description = extractDescription(markdown);
    const readingTime = estimateReadingTime(markdown);
    const createdAt = new Date().toISOString();

    // Save markdown file
    const articlePath = path.join('./data/articles', `${slug}.md`);
    await fs.writeFile(articlePath, markdown);

    // Update index
    const index = await loadIndex();
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
    res.status(500).json({ error: 'Failed to publish article' });
  }
});

// GET /:slug - View article
app.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Load article metadata
    const index = await loadIndex();
    const article = index[slug];
    
    if (!article) {
      return res.status(404).send('Article not found');
    }

    // Load article content
    const articlePath = path.join('./data/articles', `${slug}.md`);
    const markdown = await fs.readFile(articlePath, 'utf8');
    
    // Render content
    const content = render(markdown);
    
    // Load template
    const template = await fs.readFile('./views/article.html', 'utf8');
    
    // Format date
    const date = new Date(article.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Replace template variables
    const html = template
      .replace(/{{title}}/g, article.title)
      .replace(/{{description}}/g, article.description)
      .replace(/{{content}}/g, content)
      .replace(/{{date}}/g, date)
      .replace(/{{readingTime}}/g, article.readingTime);

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