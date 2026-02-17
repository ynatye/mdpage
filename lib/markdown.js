const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js');
const footnote = require('markdown-it-footnote');

// Configure markdown-it with GFM-like options
const md = new MarkdownIt({
  html: false,        // Disable HTML for security
  linkify: true,      // Auto-convert URLs to links
  typographer: true,  // Enable smart quotes and other typographic features
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }
    return ''; // Use external default escaping
  }
});

// Add footnote plugin
md.use(footnote);

// Export render function
function render(markdown) {
  return md.render(markdown);
}

// Extract title from first H1 heading
function extractTitle(markdown) {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.substring(2).trim();
    }
  }
  return 'Untitled';
}

// Generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Remove duplicate hyphens
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

// Extract first paragraph for description
function extractDescription(markdown) {
  const rendered = md.render(markdown);
  // Find first <p> tag content
  const match = rendered.match(/<p>(.*?)<\/p>/);
  if (match) {
    // Strip HTML tags and limit to ~160 chars
    return match[1].replace(/<[^>]*>/g, '').substring(0, 160).trim();
  }
  return 'A markdown article';
}

// Estimate reading time (average 200 words per minute)
function estimateReadingTime(markdown) {
  const words = markdown.split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return minutes === 1 ? '1 min read' : `${minutes} min read`;
}

module.exports = {
  render,
  extractTitle,
  generateSlug,
  extractDescription,
  estimateReadingTime
};