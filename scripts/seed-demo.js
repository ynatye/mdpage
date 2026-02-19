#!/usr/bin/env node
/**
 * scripts/seed-demo.js — Seed demo articles for local development
 *
 * Creates a handful of articles with different tiers and lifecycle states
 * so you can explore the UI and API without writing content by hand.
 *
 * Usage:
 *   # Start server with rate limits disabled (safe for local dev seeding)
 *   NODE_ENV=test node server.js &
 *   node scripts/seed-demo.js
 *
 *   # Or with a high publish limit
 *   RATE_PUBLISH_MAX=100 node server.js &
 *   node scripts/seed-demo.js
 *
 * Safe to run multiple times — each run publishes fresh slugs (free tier
 * suffix ensures uniqueness).
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:3456';

async function publish(markdown, tier = 'free', customSlug) {
  const body = { markdown, tier };
  if (customSlug) body.slug = customSlug;

  const res = await fetch(`${BASE}/api/publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Publish failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ── Preflight ────────────────────────────────────────────────────────────────

console.log(`\nSeeding demo articles → ${BASE}\n`);

try {
  const r = await fetch(`${BASE}/healthz`);
  if (!r.ok) throw new Error('not ok');
} catch {
  console.error(`✗ Server unreachable at ${BASE}`);
  console.error('  Start first: node server.js\n');
  process.exit(1);
}

// ── Articles ──────────────────────────────────────────────────────────────────

const demos = [
  {
    label:  'Free article (published)',
    tier:   'free',
    markdown: `# Getting Started with mdpage

mdpage lets you publish Markdown as a beautiful, shareable page in seconds.
No account required. Just paste your content and hit Publish.

## Why Markdown?

Markdown is the fastest path from thought to formatted text. Write naturally,
get clean typography automatically.

## Charts work too

\`\`\`chart
Month | Sales
Jan   | 120
Feb   | 145
Mar   | 98
Apr   | 167
\`\`\`

That bar chart renders automatically from the fenced block above.

## Next steps

- Try the Paid tier for a clean, custom slug
- Share your link — it's permanent (as long as traffic keeps it alive)
- Check back: if your post stays popular, it never expires
`,
  },
  {
    label:  'Paid article (no ads, clean slug)',
    tier:   'paid',
    slug:   `demo-paid-${Date.now()}`,
    markdown: `# The Paid Tier Advantage

Paid posts get a clean URL, zero ads, and never expire — regardless of traffic.

## What you get

| Feature       | Free   | Paid   |
|---------------|--------|--------|
| Slug format   | title-randomId | title |
| Ad slots      | ✓      | —      |
| Expiry        | Yes    | Never  |

## Custom slug

Your slug is set at publish time. Choose something memorable.

> This article was published with a custom slug using the Paid tier.
`,
  },
  {
    label:  'Free article (long-form demo)',
    tier:   'free',
    markdown: `# A Complete Guide to Markdown Formatting

This article demonstrates every formatting feature mdpage supports.

## Headings

Headings from H2 to H6 are supported (H1 is the article title).

### H3 Subheading
#### H4 Subheading
##### H5 Subheading

## Text Formatting

**Bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`.

## Blockquotes

> Great writing starts with clear thinking. Markdown keeps the friction low
> so the ideas can flow.

## Lists

Unordered:
- Item one
- Item two
  - Nested item

Ordered:
1. First step
2. Second step
3. Third step

## Code Blocks

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet('mdpage'));
\`\`\`

## Tables

| Column A | Column B | Column C |
|----------|----------|----------|
| Row 1    | Value    | More     |
| Row 2    | Value    | More     |

## Footnotes

mdpage supports footnotes[^1] via markdown-it-footnote.

[^1]: Footnotes appear at the bottom of the article.
`,
  },
];

// ── Publish loop ─────────────────────────────────────────────────────────────

const published = [];

for (const demo of demos) {
  try {
    const result = await publish(demo.markdown, demo.tier, demo.slug);
    console.log(`  ✓  ${demo.label}`);
    console.log(`       ${BASE}/${result.slug}`);
    published.push(result);
  } catch (err) {
    console.error(`  ✗  ${demo.label}: ${err.message}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const stats = await fetch(`${BASE}/api/internal/stats`)
  .then(r => r.json())
  .catch(() => null);

console.log(`\n${'─'.repeat(50)}`);
console.log(`Seeded ${published.length}/${demos.length} articles`);
if (stats) {
  console.log(`Index now has: ${stats.total} articles (${stats.free} free, ${stats.paid} paid)`);
}
console.log('\nOpen the app to explore:');
for (const p of published) {
  console.log(`  ${BASE}/${p.slug}`);
}
console.log('');
