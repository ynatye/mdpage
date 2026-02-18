import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import footnote from 'markdown-it-footnote';

let chartCounter = 0;

// Configure markdown-it
const md = new MarkdownIt({
  html: false,       // Disable raw HTML for security
  linkify: true,     // Auto-convert URLs to links
  typographer: true, // Smart quotes, dashes, etc.
  highlight(str, lang) {
    if (lang === 'chart') {
      const id = `mdpage-chart-${chartCounter++}`;
      const escaped = str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<div class="mdpage-chart-wrapper"><div class="mdpage-chart" id="${id}" data-chart="${escaped}"></div></div>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (_) {
        // fall through to default
      }
    }
    return ''; // Use markdown-it default escaping
  },
});

// Override fence renderer so chart blocks don't get wrapped in <pre><code>
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  if (token.info.trim() === 'chart') {
    return md.options.highlight(token.content, 'chart');
  }
  return defaultFence(tokens, idx, options, env, self);
};

md.use(footnote);

// ─── ASCII table → markdown table ────────────────────────────────────────────
// Converts +---+---+ box-drawing tables to GFM-style pipe tables.
function convertAsciiTables(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    if (/^\s*\+[-=+]+\+\s*$/.test(lines[i])) {
      const tableLines = [];
      let j = i;
      while (
        j < lines.length &&
        (/^\s*\+[-=+]+\+\s*$/.test(lines[j]) || /^\s*\|/.test(lines[j]))
      ) {
        tableLines.push(lines[j]);
        j++;
      }

      if (tableLines.length >= 3) {
        const dataRows = tableLines.filter((l) => /^\s*\|/.test(l));
        if (dataRows.length >= 1) {
          const parsed = dataRows.map((row) =>
            row
              .split('|')
              .slice(1, -1)
              .map((cell) => cell.trim())
          );

          const colCount = parsed[0].length;
          const mdRows = [
            '| ' + parsed[0].join(' | ') + ' |',
            '| ' + parsed[0].map(() => '---').join(' | ') + ' |',
          ];
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

// ─── Chart root registry (used by useChartHydration) ────────────────────────
// WeakMap: DOM element → React root, so roots are GC'd when elements are removed.
export const chartRoots = new WeakMap();

// Decode HTML-escaped chart CSV data from a DOM element's data-chart attribute.
export function getChartData(div) {
  const raw = div.getAttribute('data-chart');
  if (!raw) return null;
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Render full markdown (including the H1 title) to HTML. */
export function render(markdown) {
  chartCounter = 0;
  return md.render(preprocess(markdown));
}

/**
 * Render markdown body only — strips the first H1 to avoid duplication
 * with the article header displayed by the Article page component.
 */
export function renderContent(markdown) {
  chartCounter = 0;
  const processed = preprocess(markdown);
  const lines = processed.split('\n');
  const contentLines = [];
  let foundFirstH1 = false;

  for (const line of lines) {
    if (!foundFirstH1 && line.trim().startsWith('# ')) {
      foundFirstH1 = true;
      continue; // skip first H1
    }
    contentLines.push(line);
  }

  return md.render(contentLines.join('\n'));
}

/** Extract the first H1 heading as the article title. */
export function extractTitle(markdown) {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim();
    }
  }
  return 'Untitled';
}

/** Convert a title string into a URL-safe slug. */
export function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Extract the first paragraph (plain text, ≤160 chars) for use as meta description. */
export function extractDescription(markdown) {
  const rendered = md.render(markdown);
  const match = rendered.match(/<p>([\s\S]*?)<\/p>/);
  if (match) {
    return match[1].replace(/<[^>]*>/g, '').slice(0, 160).trim();
  }
  return 'A markdown article';
}

/** Estimate reading time based on word count at 200 wpm. */
export function estimateReadingTime(markdown) {
  const words = markdown.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return minutes === 1 ? '1 min read' : `${minutes} min read`;
}
