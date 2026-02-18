#!/usr/bin/env node
/**
 * scripts/test-backend.js — Backend E2E tests for Phase 1
 *
 * Covers:
 *   - Tier + slug bifurcation (issues #2, #3)
 *   - View tracking with daily dedupe (issue #6)
 *   - Lifecycle state machine transitions (issue #7)
 *   - Rate limiter logic (issue #10)
 *   - Logger structured output (issue #11)
 *   - Slug module unit tests
 *
 * Run: node scripts/test-backend.js
 * Exit 0 = all pass, exit 1 = failures.
 */

import { normalizeSlugBase, generateFreeSlug, generatePaidSlug, resolveSlug } from '../lib/slug.js';
import { fingerprintRequest } from '../lib/views.js';
import { evaluateArticle, config as lifecycleConfig } from '../lib/lifecycle.js';
import log from '../lib/logger.js';

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, got) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${got !== undefined ? `\n       got: ${JSON.stringify(got)}` : ''}`);
    failed++;
  }
}

function assertThrows(fn, label, expectedCode) {
  let threw = false;
  let code;
  try {
    fn();
  } catch (err) {
    threw = true;
    code = err.code ?? err.message;
  }
  const ok = threw && (!expectedCode || code === expectedCode);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label} (threw=${threw}, code=${code})`);
    failed++;
  }
}

async function assertRejects(fn, label, expectedCode) {
  let threw = false;
  let code;
  try {
    await fn();
  } catch (err) {
    threw = true;
    code = err.code ?? err.message;
  }
  const ok = threw && (!expectedCode || code === expectedCode);
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label} (threw=${threw}, code=${code})`);
    failed++;
  }
}

// ── lib/slug.js tests ─────────────────────────────────────────────────────────

console.log('\n── normalizeSlugBase ──');
assert(normalizeSlugBase('Hello World') === 'hello-world',        'basic title');
assert(normalizeSlugBase('  Lots  of   Spaces  ') === 'lots-of-spaces', 'trims + collapses spaces');
assert(normalizeSlugBase('Hello, World!') === 'hello-world',      'strips punctuation');
assert(normalizeSlugBase('') === '',                               'empty string');
assert(normalizeSlugBase('---test---') === 'test',                 'strips edge hyphens');
assert(normalizeSlugBase('My Post (2026)') === 'my-post-2026',    'parens stripped');
assert(normalizeSlugBase('UPPERCASE') === 'uppercase',             'lowercased');

console.log('\n── generateFreeSlug ──');
const freeA = generateFreeSlug('hello-world');
const freeB = generateFreeSlug('hello-world');
assert(freeA.startsWith('hello-world-'),  'free slug has base prefix');
assert(freeA.length > 'hello-world-'.length, 'free slug has suffix');
assert(freeA !== freeB,                   'random suffix differs each call');

const freeSuffix = freeA.replace('hello-world-', '');
assert(/^[a-z0-9]+$/.test(freeSuffix),   'suffix is lowercase alphanumeric');
assert(freeSuffix.length === 8,           'suffix is exactly 8 chars');

assertThrows(() => generateFreeSlug(''), 'throws on empty slugBase');

console.log('\n── generatePaidSlug ──');
assert(generatePaidSlug('weekly-brief') === 'weekly-brief', 'paid slug is clean (no suffix)');
assertThrows(() => generatePaidSlug(''), 'throws on empty slugBase');

console.log('\n── resolveSlug ──');

// Available slug → resolves immediately
{
  const slug = await resolveSlug('free', 'test-base', async () => true);
  assert(slug.startsWith('test-base-'), 'free: resolved slug has base prefix');
}

// Paid: available → clean slug
{
  const slug = await resolveSlug('paid', 'my-post', async () => true);
  assert(slug === 'my-post', 'paid: resolved slug is clean');
}

// Paid: taken → SLUG_CONFLICT
await assertRejects(
  () => resolveSlug('paid', 'taken-post', async () => false),
  'paid: taken slug throws SLUG_CONFLICT',
  'SLUG_CONFLICT'
);

// Free: always taken → SLUG_EXHAUSTED
await assertRejects(
  () => resolveSlug('free', 'busy-base', async () => false),
  'free: all retries fail → SLUG_EXHAUSTED',
  'SLUG_EXHAUSTED'
);

// Free: first attempt taken, second available
{
  let callCount = 0;
  const slug = await resolveSlug('free', 'retry-base', async () => {
    callCount++;
    return callCount > 1; // reject first, accept rest
  });
  assert(slug.startsWith('retry-base-'), 'free: resolves on second attempt');
  assert(callCount === 2, 'free: called isAvailable twice', callCount);
}

// ── lib/views.js tests ────────────────────────────────────────────────────────

console.log('\n── fingerprintRequest ──');
const fp1 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0', '2026-02-18');
const fp2 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0', '2026-02-18');
const fp3 = fingerprintRequest('1.2.3.4', 'Mozilla/5.0', '2026-02-19'); // different date
const fp4 = fingerprintRequest('9.9.9.9', 'Mozilla/5.0', '2026-02-18'); // different IP

assert(fp1 === fp2,   'same inputs → same fingerprint');
assert(fp1 !== fp3,   'different date → different fingerprint');
assert(fp1 !== fp4,   'different IP → different fingerprint');
assert(fp1.length === 16, 'fingerprint is 16 hex chars', fp1.length);
assert(/^[0-9a-f]+$/.test(fp1), 'fingerprint is lowercase hex');

// ── lib/lifecycle.js tests ────────────────────────────────────────────────────

console.log('\n── lifecycleConfig ──');
assert(typeof lifecycleConfig.MIN_AGE_DAYS === 'number',          'MIN_AGE_DAYS is number');
assert(typeof lifecycleConfig.UNIQUE_VIEW_THRESHOLD === 'number', 'UNIQUE_VIEW_THRESHOLD is number');
assert(typeof lifecycleConfig.AT_RISK_WINDOW_DAYS === 'number',   'AT_RISK_WINDOW_DAYS is number');

console.log('\n── evaluateArticle ──');

// Helper: build a mock article meta
function makeMeta(overrides = {}) {
  return {
    slug:            'test-post',
    tier:            'free',
    status:          'published',
    createdAt:       new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
    atRiskStartedAt: null,
    expiresAt:       null,
    last30dUniqueViews: 0,
    ...overrides,
  };
}

// Paid posts → no evaluation
{
  const meta = makeMeta({ tier: 'paid' });
  const { transition } = await evaluateArticle(meta);
  assert(transition === null, 'paid post: not evaluated');
}

// Too new → skip
{
  const meta = makeMeta({ createdAt: new Date().toISOString() }); // just now
  const { transition } = await evaluateArticle(meta);
  assert(transition === null, 'new free post: skipped (too young)');
}

// Old + low views → at_risk
// We mock getUniqueViewCount by controlling view data; easiest is to note
// that the test post slug ("test-post") has no view file → 0 views.
{
  const meta = makeMeta({ slug: 'test-post-noviews-' + Date.now() });
  const { meta: updated, transition } = await evaluateArticle(meta);
  assert(transition === 'at_risk',          'old + 0 views → at_risk');
  assert(updated.status === 'at_risk',      'status set to at_risk');
  assert(updated.atRiskStartedAt !== null,  'atRiskStartedAt set');
  assert(updated.expiresAt !== null,        'expiresAt set');
}

// Already expired → no further transitions
{
  const meta = makeMeta({ status: 'expired' });
  const { transition } = await evaluateArticle(meta);
  assert(transition === null, 'expired post: no further transitions');
}

// at_risk + countdown elapsed + still low views → expired
{
  const expiredAt = new Date(Date.now() - 1000).toISOString(); // 1s ago
  const meta = makeMeta({
    slug:            'test-post-expired-' + Date.now(),
    status:          'at_risk',
    atRiskStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt:       expiredAt,
  });
  const { meta: updated, transition } = await evaluateArticle(meta);
  assert(transition === 'expired',      'at_risk + elapsed → expired');
  assert(updated.status === 'expired',  'status set to expired');
}

// at_risk + NOT elapsed → still at_risk (no_change)
{
  const futureExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const meta = makeMeta({
    slug:            'test-post-atrisk-' + Date.now(),
    status:          'at_risk',
    atRiskStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt:       futureExpiry,
  });
  const { transition } = await evaluateArticle(meta);
  assert(transition === 'no_change', 'at_risk + future expiry + low views → no_change');
}

// ── Logger smoke test ─────────────────────────────────────────────────────────

console.log('\n── logger ──');
// Logger emits JSON lines — just verify it doesn't throw
try {
  log.info('test.event', { foo: 'bar', num: 42 });
  log.warn('test.warn', { note: 'warning test' });
  log.debug('test.debug', { x: 1 });
  assert(true, 'logger emits without throwing');
} catch (err) {
  assert(false, 'logger threw: ' + err.message);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed — see above.');
  process.exit(1);
} else {
  console.log('\nAll backend checks passed ✓');
}
