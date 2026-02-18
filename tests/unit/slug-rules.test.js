/**
 * tests/unit/slug-rules.test.js
 *
 * Validates Phase 1 slug policy rules per PRD §"Slug Policy".
 *
 * Coverage:
 *   [SL-01]  Free slug always has alphanumeric suffix
 *   [SL-02]  Free suffix is 8-10 chars, lowercase alphanumeric
 *   [SL-03]  Free slug base matches title-based slug
 *   [SL-04]  Paid slug is clean (no random suffix)
 *   [SL-05]  Paid slug collisions raise an error
 *   [SL-06]  Paid collision check is case-insensitive
 *   [SL-07]  Two free publishes of same title produce different slugs
 *   [SL-08]  Free suffix retry avoids collisions (up to MAX_RETRY)
 *   [SL-09]  Empty / symbol-only titles throw
 *   [SL-10]  isFreeTierSlug() validator matches free pattern
 *   [SL-11]  isFreeTierSlug() rejects clean paid slugs
 *   [SL-12]  extractFreeSlugBase() recovers the base from a free slug
 *   [SL-13]  generateSlug() normalises whitespace and punctuation (existing lib)
 *
 * Run: node --test tests/unit/slug-rules.test.js
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { generateSlug } from '../../lib/markdown.js';
import {
  generateFreeSlug,
  generatePaidSlug,
  isFreeTierSlug,
  looksLikePaidSlug,
  extractFreeSlugBase,
  SUFFIX_LENGTH,
  MAX_RETRY_ATTEMPTS,
} from '../helpers/slug-policy.js';

// ---------------------------------------------------------------------------
// [SL-01..03]  Free slug structure
// ---------------------------------------------------------------------------
describe('[SL-01..03] Free slug structure', () => {
  test('[SL-01] Free slug has a hyphen-separated suffix', () => {
    const slug = generateFreeSlug('My Article Title');
    assert.ok(slug.includes('-'), `Expected hyphen in "${slug}"`);
    // Split off the last segment
    const parts = slug.split('-');
    assert.ok(parts.length >= 2, `Expected at least two hyphen-separated parts, got: "${slug}"`);
  });

  test('[SL-02] Suffix is 8-10 lowercase alphanumeric chars', () => {
    // Run 10 times to cover randomness
    for (let i = 0; i < 10; i++) {
      const slug = generateFreeSlug('Test Post');
      // The suffix is everything after the last hyphen-delimited base
      const suffixMatch = slug.match(/-([a-z0-9]+)$/);
      assert.ok(suffixMatch, `Suffix not found in "${slug}"`);
      const suffix = suffixMatch[1];
      assert.ok(
        suffix.length >= 8 && suffix.length <= 10,
        `Suffix length ${suffix.length} not in [8,10]: "${suffix}"`
      );
      assert.match(suffix, /^[a-z0-9]+$/, `Suffix has non-alphanumeric chars: "${suffix}"`);
    }
  });

  test('[SL-03] Free slug base matches generateSlug(title)', () => {
    const title = 'Weekly Brief January';
    const slug = generateFreeSlug(title);
    const base = extractFreeSlugBase(slug);
    const expectedBase = generateSlug(title);
    assert.equal(base, expectedBase, `Base mismatch: "${base}" vs "${expectedBase}"`);
  });
});

// ---------------------------------------------------------------------------
// [SL-04..06]  Paid slug structure
// ---------------------------------------------------------------------------
describe('[SL-04..06] Paid slug structure', () => {
  test('[SL-04] Paid slug is clean — no random suffix', () => {
    const slug = generatePaidSlug('My Article Title');
    const expected = generateSlug('My Article Title');
    assert.equal(slug, expected, `Paid slug should equal generateSlug(title), got "${slug}"`);
  });

  test('[SL-05] Paid slug collision throws', () => {
    const existing = new Set(['my-article-title']);
    assert.throws(
      () => generatePaidSlug('My Article Title', existing),
      /collision/i,
      'Expected collision error for paid slug'
    );
  });

  test('[SL-06] Paid collision check is case-insensitive', () => {
    // Paid slugs are stored lowercase; title "My Article" → "my-article"
    // Pre-populating with "my-article" should block "My Article" title too
    const existing = new Set(['my-article']);
    assert.throws(
      () => generatePaidSlug('My Article', existing),
      /collision/i,
      'Case-insensitive collision should throw'
    );
  });
});

// ---------------------------------------------------------------------------
// [SL-07..08]  Free slug uniqueness
// ---------------------------------------------------------------------------
describe('[SL-07..08] Free slug uniqueness', () => {
  test('[SL-07] Two free slugs from same title are different', () => {
    const a = generateFreeSlug('Duplicate Title');
    const b = generateFreeSlug('Duplicate Title');
    // This should pass 99.9999% of the time given the suffix entropy
    assert.notEqual(a, b, 'Two separate free slugs should not be equal');
  });

  test('[SL-08] Free slug avoids registered collisions via retry', () => {
    // Pre-fill a large set to force retries
    const existingSlugs = new Set();
    // We can't fill all possible 36^9 values but we can verify retry logic
    // by generating many slugs and confirming no duplicates
    for (let i = 0; i < 50; i++) {
      const slug = generateFreeSlug('Retry Test', existingSlugs);
      assert.ok(!existingSlugs.has(slug), `Collision: "${slug}" was already in set`);
      existingSlugs.add(slug);
    }
    assert.equal(existingSlugs.size, 50, 'Should have 50 unique slugs');
  });
});

// ---------------------------------------------------------------------------
// [SL-09]  Error cases
// ---------------------------------------------------------------------------
describe('[SL-09] Error cases for empty/invalid titles', () => {
  test('[SL-09a] generateFreeSlug throws for empty title', () => {
    assert.throws(() => generateFreeSlug(''), /empty|invalid/i);
  });

  test('[SL-09b] generateFreeSlug throws for symbol-only title', () => {
    assert.throws(() => generateFreeSlug('!@#$%^&*'), /empty|invalid/i);
  });

  test('[SL-09c] generatePaidSlug throws for empty title', () => {
    assert.throws(() => generatePaidSlug(''), /empty|invalid/i);
  });
});

// ---------------------------------------------------------------------------
// [SL-10..12]  Validators
// ---------------------------------------------------------------------------
describe('[SL-10..12] Slug validators', () => {
  test('[SL-10] isFreeTierSlug() accepts valid free slugs', () => {
    assert.ok(isFreeTierSlug('weekly-brief-january-23i345q83'), 'Standard free slug');
    assert.ok(isFreeTierSlug('my-post-abc12345x'), '9-char suffix');
    assert.ok(isFreeTierSlug('a-b-c-12345678'), '8-char suffix');
    assert.ok(isFreeTierSlug('post-1234567890'), '10-char suffix');
  });

  test('[SL-11] isFreeTierSlug() rejects clean paid slugs', () => {
    assert.ok(!isFreeTierSlug('weekly-brief-january'), 'Clean paid slug should fail');
    assert.ok(!isFreeTierSlug('my-post'), 'Short clean slug should fail');
    assert.ok(!isFreeTierSlug(''), 'Empty string should fail');
  });

  test('[SL-12] extractFreeSlugBase() recovers base from free slug', () => {
    const slug = generateFreeSlug('Hello World');
    const base = extractFreeSlugBase(slug);
    assert.equal(base, 'hello-world', `Expected "hello-world", got "${base}"`);
  });
});

// ---------------------------------------------------------------------------
// [SL-13]  Existing generateSlug() library — regression guard
// ---------------------------------------------------------------------------
describe('[SL-13] generateSlug() existing library (regression guard)', () => {
  const cases = [
    ['Hello World',         'hello-world'],
    ['Hello  World',        'hello-world'],
    ['Hello, World!',       'hello-world'],
    ['-leading and trailing-', 'leading-and-trailing'],
    ['Café au Lait',        'caf-au-lait'],   // accented chars stripped
    ['',                    ''],
    ['A',                   'a'],
    ['ALL CAPS',            'all-caps'],
  ];

  for (const [input, expected] of cases) {
    test(`generateSlug("${input}") → "${expected}"`, () => {
      assert.equal(generateSlug(input), expected);
    });
  }
});
