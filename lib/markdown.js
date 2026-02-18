import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import footnote from 'markdown-it-footnote';

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

// Convert ASCII box tables (+---+---+) to proper markdown tables
function convertAsciiTables(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    // Detect a separator line: starts with + and contains +---+
    if (/^\s*\+[-=+]+\+\s*$/.test(lines[i])) {
      // Collect the entire ASCII table block
      const tableLines = [];
      let j = i;
      while (j < lines.length && (/^\s*\+[-=+]+\+\s*$/.test(lines[j]) || /^\s*\|/.test(lines[j]))) {
        tableLines.push(lines[j]);
        j++;
      }

      // Need at least a separator + header row + separator + data row
      if (tableLines.length >= 3) {
        // Extract data rows (lines starting with |)
        const dataRows = tableLines.filter(l => /^\s*\|/.test(l));
        
        if (dataRows.length >= 1) {
          // Parse cells from pipe-delimited rows
          const parsed = dataRows.map(row => {
            return row.split('|')
              .slice(1, -1) // remove first/last empty splits
              .map(cell => cell.trim());
          });

          // Build markdown table: first row is header
          const colCount = parsed[0].length;
          const mdRows = [];
          // Header
          mdRows.push('| ' + parsed[0].join(' | ') + ' |');
          // Separator
          mdRows.push('| ' + parsed[0].map(() => '---').join(' | ') + ' |');
          // Data rows
          for (let k = 1; k < parsed.length; k++) {
            // Pad if row has fewer columns
            const cells = parsed[k];
            while (cells.length < colCount) cells.push('');
            mdRows.push('| ' + cells.join(' | ') + ' |');
          }

          result.push(...mdRows);
          i = j;
          continue;
        }
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join('\n');
}

// Pre-process markdown before rendering
function preprocess(markdown) {
  return convertAsciiTables(markdown);
}

// Export render function
export function render(markdown) {
  return md.render(preprocess(markdown));
}

// Render markdown content, stripping the first H1 to avoid duplication with header
export function renderContent(markdown) {
  const processed = preprocess(markdown);
  const lines = processed.split('\n');
  let contentLines = [];
  let foundFirstH1 = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundFirstH1 && trimmed.startsWith('# ')) {
      foundFirstH1 = true;
      continue; // Skip the first H1
    }
    contentLines.push(line);
  }
  
  return md.render(contentLines.join('\n'));
}

// Extract title from first H1 heading
export function extractTitle(markdown) {
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
export function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Remove duplicate hyphens
    .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

// Extract first paragraph for description
export function extractDescription(markdown) {
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
export function estimateReadingTime(markdown) {
  const words = markdown.split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return minutes === 1 ? '1 min read' : `${minutes} min read`;
}