import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import footnote from 'markdown-it-footnote';

let chartCounter = 0;

// Configure markdown-it with GFM-like options
const md = new MarkdownIt({
  html: false,        // Disable HTML for security
  linkify: true,      // Auto-convert URLs to links
  typographer: true,  // Enable smart quotes and other typographic features
  highlight: function (str, lang) {
    if (lang === 'chart') {
      const id = `mdpage-chart-${chartCounter++}`;
      const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<div class="mdpage-chart-wrapper"><div class="mdpage-chart" id="${id}" data-chart="${escaped}"></div></div>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }
    return ''; // Use external default escaping
  }
});

// Override fence renderer to not wrap chart blocks in <pre><code>
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  if (token.info.trim() === 'chart') {
    return md.options.highlight(token.content, 'chart');
  }
  return defaultFence(tokens, idx, options, env, self);
};

// Add footnote plugin
md.use(footnote);

// Convert ASCII box tables (+---+---+) to proper markdown tables
function convertAsciiTables(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (/^\s*\+[-=+]+\+\s*$/.test(lines[i])) {
      const tableLines = [];
      let j = i;
      while (j < lines.length && (/^\s*\+[-=+]+\+\s*$/.test(lines[j]) || /^\s*\|/.test(lines[j]))) {
        tableLines.push(lines[j]);
        j++;
      }

      if (tableLines.length >= 3) {
        const dataRows = tableLines.filter(l => /^\s*\|/.test(l));
        
        if (dataRows.length >= 1) {
          const parsed = dataRows.map(row => {
            return row.split('|')
              .slice(1, -1)
              .map(cell => cell.trim());
          });

          const colCount = parsed[0].length;
          const mdRows = [];
          mdRows.push('| ' + parsed[0].join(' | ') + ' |');
          mdRows.push('| ' + parsed[0].map(() => '---').join(' | ') + ' |');
          for (let k = 1; k < parsed.length; k++) {
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

function preprocess(markdown) {
  return convertAsciiTables(markdown);
}

// Store chart roots for cleanup - exported so pages can use it
export const chartRoots = new WeakMap();

// Helper function to get chart data from DOM element
export function getChartData(div) {
  const raw = div.getAttribute('data-chart');
  if (!raw) return null;
  
  // Decode the escaped CSV data
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// Placeholder functions - actual implementation moved to React components
export function hydrateCharts(container) {
  // This will be implemented in the React components using createRoot
  console.log('hydrateCharts called - should be implemented in React components');
}

export function destroyCharts(container) {
  // This will be implemented in the React components
  console.log('destroyCharts called - should be implemented in React components');
}

// Export render function
export function render(markdown) {
  chartCounter = 0;
  return md.render(preprocess(markdown));
}

// Render markdown content, stripping the first H1 to avoid duplication with header
export function renderContent(markdown) {
  chartCounter = 0;
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