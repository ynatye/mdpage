import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

let chartCounter = 0;

// Parse CSV-like chart data into Chart.js config
function parseChartData(str) {
  const lines = str.trim().split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map(h => h.trim());
  const labelCol = headers[0];
  const datasetNames = headers.slice(1);

  const labels = [];
  const datasets = datasetNames.map(name => ({ label: name, data: [] }));

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    labels.push(cols[0]);
    for (let d = 0; d < datasetNames.length; d++) {
      datasets[d].data.push(parseFloat(cols[d + 1]) || 0);
    }
  }

  return { labels, datasets };
}

// Configure markdown-it with GFM-like options
const md = new MarkdownIt({
  html: false,        // Disable HTML for security
  linkify: true,      // Auto-convert URLs to links
  typographer: true,  // Enable smart quotes and other typographic features
  highlight: function (str, lang) {
    if (lang === 'chart') {
      const id = `mdpage-chart-${chartCounter++}`;
      const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<div class="mdpage-chart-wrapper"><canvas id="${id}" data-chart="${escaped}"></canvas></div>`;
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
    // highlight already returned the canvas HTML, just return it directly
    return md.options.highlight(token.content, 'chart');
  }
  return defaultFence(tokens, idx, options, env, self);
};

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

// Color palette for chart datasets
const chartColors = [
  'rgba(59, 130, 246, 0.8)',   // blue
  'rgba(16, 185, 129, 0.8)',   // green
  'rgba(245, 158, 11, 0.8)',   // amber
  'rgba(239, 68, 68, 0.8)',    // red
  'rgba(139, 92, 246, 0.8)',   // purple
  'rgba(236, 72, 153, 0.8)',   // pink
  'rgba(6, 182, 212, 0.8)',    // cyan
];

const chartColorsBorder = [
  'rgba(59, 130, 246, 1)',
  'rgba(16, 185, 129, 1)',
  'rgba(245, 158, 11, 1)',
  'rgba(239, 68, 68, 1)',
  'rgba(139, 92, 246, 1)',
  'rgba(236, 72, 153, 1)',
  'rgba(6, 182, 212, 1)',
];

// Hydrate all chart canvases in a container
export function hydrateCharts(container) {
  if (!container) return;
  const canvases = container.querySelectorAll('canvas[data-chart]');
  canvases.forEach(canvas => {
    const raw = canvas.getAttribute('data-chart');
    if (!raw || canvas._chartInstance) return;

    const parsed = parseChartData(raw);
    if (!parsed) return;

    // Apply colors
    parsed.datasets.forEach((ds, i) => {
      ds.backgroundColor = chartColors[i % chartColors.length];
      ds.borderColor = chartColorsBorder[i % chartColorsBorder.length];
      ds.borderWidth = 2;
      ds.borderRadius = 4;
    });

    // Detect if dark mode
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

    canvas._chartInstance = new Chart(canvas, {
      type: 'bar',
      data: parsed,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: { color: textColor, font: { family: 'Inter', size: 13 } }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { family: 'Inter', size: 12 } },
            grid: { color: gridColor }
          },
          y: {
            ticks: { color: textColor, font: { family: 'Inter', size: 12 } },
            grid: { color: gridColor }
          }
        }
      }
    });
  });
}

// Destroy chart instances before re-render
export function destroyCharts(container) {
  if (!container) return;
  const canvases = container.querySelectorAll('canvas[data-chart]');
  canvases.forEach(canvas => {
    if (canvas._chartInstance) {
      canvas._chartInstance.destroy();
      canvas._chartInstance = null;
    }
  });
}

// Export render function
export function render(markdown) {
  chartCounter = 0;
  return md.render(preprocess(markdown));
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