#!/usr/bin/env node
// Lightweight validation script for the publish workflow.
// Tests lib/markdown.js (server-side) functions without needing a running server.
// Run: node scripts/validate-publish.js
import { extractTitle, generateSlug, extractDescription, estimateReadingTime, render, renderContent } from '../lib/markdown.js'

let passed = 0
let failed = 0

function assert(condition, label, got) {
  if (condition) {
    console.log(`  ✓  ${label}`)
    passed++
  } else {
    console.error(`  ✗  ${label}${got !== undefined ? `\n       got: ${JSON.stringify(got)}` : ''}`)
    failed++
  }
}

// ── extractTitle ─────────────────────────────────────────────────────────────
console.log('\nextractTitle')
assert(extractTitle('# Hello World\n\nParagraph') === 'Hello World', 'basic H1')
assert(extractTitle('No heading here') === 'Untitled', 'no H1 → Untitled')
assert(extractTitle('## Not H1\n# Actual Title') === 'Actual Title', 'finds first H1 (not H2)')
assert(extractTitle('  # Indented Title') === 'Indented Title', 'handles leading whitespace')

// ── generateSlug ─────────────────────────────────────────────────────────────
console.log('\ngenerateSlug')
assert(generateSlug('Hello World') === 'hello-world', 'basic slug')
assert(generateSlug('Hello  World') === 'hello-world', 'double space → single hyphen')
assert(generateSlug('Hello, World!') === 'hello-world', 'strips punctuation')
assert(generateSlug('-leading and trailing-') === 'leading-and-trailing', 'strips edge hyphens')
assert(generateSlug('') === '', 'empty string → empty slug')

// ── extractDescription ───────────────────────────────────────────────────────
console.log('\nextractDescription')

const simpleMd = '# Title\n\nA simple paragraph.'
const simpleDesc = extractDescription(simpleMd)
assert(simpleDesc === 'A simple paragraph.', 'single-line paragraph', simpleDesc)

const multiLineMd = '# Title\n\nFirst line\nsecond line\nthird line.'
const multiDesc = extractDescription(multiLineMd)
assert(multiDesc !== 'A markdown article', 'multi-line paragraph (bug fix)', multiDesc)
assert(multiDesc.includes('second line'), 'multi-line paragraph contains wrapped text', multiDesc)

const noParaMd = '# Title Only'
assert(extractDescription(noParaMd) === 'A markdown article', 'no paragraph → fallback')

const longParaMd = '# T\n\n' + 'A'.repeat(200)
const longDesc = extractDescription(longParaMd)
assert(longDesc.length <= 160, 'description capped at 160 chars', longDesc.length)

// ── estimateReadingTime ──────────────────────────────────────────────────────
console.log('\nestimateReadingTime')
// 200 words → 1 min; 201 → 2 min
const oneMin = Array(200).fill('word').join(' ')
assert(estimateReadingTime(oneMin) === '1 min read', '200 words → 1 min read')
const twoMin = Array(201).fill('word').join(' ')
assert(estimateReadingTime(twoMin) === '2 min read', '201 words → 2 min read')
// whitespace-only shouldn't return garbage
const whitespace = '   \n\t  '
const wsResult = estimateReadingTime(whitespace)
assert(wsResult === '1 min read', 'whitespace-only content', wsResult)

// ── render ───────────────────────────────────────────────────────────────────
console.log('\nrender')
const html = render('# Title\n\nParagraph.')
assert(html.includes('<h1>Title</h1>'), 'renders H1', html.slice(0, 60))
assert(html.includes('<p>Paragraph.</p>'), 'renders paragraph')

// ── renderContent ─────────────────────────────────────────────────────────────
console.log('\nrenderContent')
const contentHtml = renderContent('# Title\n\nBody paragraph.\n\n## Section')
assert(!contentHtml.includes('<h1>'), 'H1 stripped from content')
assert(contentHtml.includes('<p>Body paragraph.</p>'), 'body paragraph present')
assert(contentHtml.includes('<h2>Section</h2>'), 'H2 preserved')

// H1 in body (after first one) should still render
const multiH1 = '# First\n\nContent.\n\n# Second\n\nMore.'
const multiH1Content = renderContent(multiH1)
assert(!multiH1Content.startsWith('<h1>First'), 'first H1 stripped')
assert(multiH1Content.includes('<h1>Second</h1>'), 'second H1 preserved in body')

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('\nSome checks failed — see above.')
  process.exit(1)
} else {
  console.log('\nAll checks passed ✓')
}
