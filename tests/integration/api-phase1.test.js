/**
 * tests/integration/api-phase1.test.js
 *
 * Integration tests for Phase 1 API contracts.
 * Requires a running server at SERVER_URL (default: http://localhost:3456).
 *
 * Strict mode is ON by default (INTEGRATION_STRICT_PHASE1=1 implied):
 *   - server unreachable => hard failure
 *   - missing critical Phase 1 contracts => hard failure
 *
 * Exploratory mode (INTEGRATION_STRICT_PHASE1=0) allows skips for incomplete
 * Phase 1 endpoints, but should not be used in CI.
 *
 * Coverage:
 *   [API-01]  POST /api/publish — basic publish (current, must pass now)
 *   [API-02]  POST /api/publish — free tier → suffixed slug  [PHASE 1]
 *   [API-03]  POST /api/publish — paid tier → clean slug     [PHASE 1]
 *   [API-04]  POST /api/publish — paid collision → 4xx       [PHASE 1]
 *   [API-05]  POST /api/publish — adEnabled false for paid   [PHASE 1]
 *   [API-06]  GET  /api/articles/:slug — returns tier + adEnabled [PHASE 1]
 *   [API-07]  POST /api/articles/:slug/view — returns 200    [PHASE 1]
 *   [API-08]  POST /api/articles/:slug/view — idempotent same visitor+day [PHASE 1]
 *   [API-09]  GET  /api/articles/:slug — 404 for unknown slug
 *   [API-10]  POST /api/publish — validation: missing markdown → 400
 *   [API-11]  POST /api/publish — validation: no title → 400
 *   [API-12]  GET  /api/internal/lifecycle/:slug — returns lifecycle state [PHASE 1]
 *
 * Run: node tests/integration/api-phase1.test.js
 * Or:  SERVER_URL=http://your-server node tests/integration/api-phase1.test.js
 */

import { TestRunner, apiFetch, serverIsReachable, makeArticle } from '../helpers/test-utils.js';
import { isFreeTierSlug } from '../helpers/slug-policy.js';

const t = new TestRunner('API Phase 1 Integration');
const STRICT_PHASE1 = process.env.INTEGRATION_STRICT_PHASE1 !== '0';

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
const reachable = await serverIsReachable();
if (!reachable) {
  console.error('\n✗ Server not reachable at SERVER_URL.');
  console.error('  Expected /healthz to respond before running integration checks.');
  console.error('  Hint: run `npm run test:integration` (self-managed local server)');
  console.error('  Or set SERVER_URL to a live server that exposes /healthz.\n');
  process.exit(1);
}

console.log('\n[API Phase 1 Integration Tests]\n');

// ---------------------------------------------------------------------------
// [API-10..11]  Input validation (current implementation)
// ---------------------------------------------------------------------------

console.log('── Input Validation ──');

{
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify({ markdown: '' }),
  });
  t.ok(res.status === 400, '[API-10] Empty markdown → 400', { status: res.status, body: res.body });
}

{
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify({ markdown: 'No title here, just text.' }),
  });
  t.ok(res.status === 400, '[API-11] No title → 400', { status: res.status, body: res.body });
}

// ---------------------------------------------------------------------------
// [API-01]  Basic publish (current implementation — must pass now)
// ---------------------------------------------------------------------------

console.log('\n── Basic Publish (current) ──');

let baseSlug;
{
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify(makeArticle({ title: `QA Test ${Date.now()}` })),
  });
  t.ok(res.ok, '[API-01] Basic publish → 200', { status: res.status, body: res.body });
  t.ok(typeof res.body?.slug === 'string', '[API-01b] Response includes slug field');
  t.ok(typeof res.body?.url === 'string', '[API-01c] Response includes url field');
  baseSlug = res.body?.slug;
}

// ---------------------------------------------------------------------------
// [API-09]  404 for unknown slug
// ---------------------------------------------------------------------------

console.log('\n── 404 Handling ──');

{
  const res = await apiFetch('/api/articles/this-slug-definitely-does-not-exist-qa123');
  t.ok(res.status === 404, '[API-09] Unknown slug → 404', { status: res.status });
}

// ---------------------------------------------------------------------------
// Phase 1 feature detection
// ---------------------------------------------------------------------------

// Check if server supports `tier` in publish response
let phase1Implemented = false;
{
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify({ ...makeArticle({ title: `Phase1 Probe ${Date.now()}` }), tier: 'free' }),
  });
  if (res.ok && res.body?.tier !== undefined) {
    phase1Implemented = true;
    console.log('\n✓ Phase 1 tier support detected — running full suite\n');
  } else {
    console.log('\n⊘ Phase 1 not yet implemented — skipping tier/view/lifecycle tests\n');
    console.log('  (These will PASS once backend implements tier + slug bifurcation)\n');
  }
}

if (!phase1Implemented) {
  const reason = 'Phase 1 contracts unavailable (tier/adEnabled in publish response missing)';

  if (STRICT_PHASE1) {
    t.ok(false, '[API-Phase1-Required] Strict mode requires full Phase 1 API support', {
      reason,
      hint: 'Set INTEGRATION_STRICT_PHASE1=0 only for temporary exploratory runs',
    });
    t.summary();
    process.exit(1);
  }

  // Non-strict exploratory mode only
  const phase1Tests = [
    '[API-02] free tier → suffixed slug',
    '[API-03] paid tier → clean slug',
    '[API-04] paid collision → 4xx',
    '[API-05] paid → adEnabled false',
    '[API-06] GET article returns tier + adEnabled',
    '[API-07] POST /view → 200',
    '[API-08] POST /view idempotent',
    '[API-12] GET /internal/lifecycle/:slug',
  ];
  phase1Tests.forEach((name) => t.skip(name, reason));

  t.summary();
  process.exit(t.failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// [API-02]  Free tier → suffixed slug
// ---------------------------------------------------------------------------

console.log('── Tier: Free ──');

let freeSlug;
{
  const title = `Free Post ${Date.now()}`;
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify({ ...makeArticle({ title }), tier: 'free' }),
  });
  t.ok(res.ok, '[API-02] Free publish → 200', { status: res.status });
  t.equal(res.body?.tier, 'free', '[API-02b] Response tier is "free"');
  t.equal(res.body?.adEnabled, true, '[API-02c] Free post has adEnabled = true');
  t.ok(isFreeTierSlug(res.body?.slug), '[API-02d] Free slug has random suffix', { slug: res.body?.slug });
  freeSlug = res.body?.slug;
}

// Publish same title AGAIN as free — should get a DIFFERENT slug (different random suffix)
{
  const title = `Duplicate Free Post`;
  const res1 = await apiFetch('/api/publish', { method: 'POST', body: JSON.stringify({ ...makeArticle({ title }), tier: 'free' }) });
  const res2 = await apiFetch('/api/publish', { method: 'POST', body: JSON.stringify({ ...makeArticle({ title }), tier: 'free' }) });
  t.ok(res1.body?.slug !== res2.body?.slug, '[API-02e] Two free publishes of same title → different slugs', {
    slug1: res1.body?.slug, slug2: res2.body?.slug
  });
}

// ---------------------------------------------------------------------------
// [API-03..05]  Paid tier
// ---------------------------------------------------------------------------

console.log('\n── Tier: Paid ──');

let paidSlug;
{
  const title = `Paid Post ${Date.now()}`;
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify({ ...makeArticle({ title }), tier: 'paid' }),
  });
  t.ok(res.ok, '[API-03] Paid publish → 200', { status: res.status });
  t.equal(res.body?.tier, 'paid', '[API-03b] Response tier is "paid"');
  t.equal(res.body?.adEnabled, false, '[API-05] Paid post has adEnabled = false');
  t.ok(!isFreeTierSlug(res.body?.slug), '[API-03c] Paid slug has NO random suffix', { slug: res.body?.slug });
  paidSlug = res.body?.slug;
}

// Paid collision — same title again → should 4xx
{
  if (paidSlug) {
    const title = paidSlug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const res = await apiFetch('/api/publish', {
      method: 'POST',
      body: JSON.stringify({ ...makeArticle({ title }), tier: 'paid', slug: paidSlug }),
    });
    t.ok(!res.ok && res.status >= 400 && res.status < 500, '[API-04] Paid collision → 4xx', {
      status: res.status, body: res.body
    });
  } else {
    t.skip('[API-04] Paid collision', 'paidSlug not set from previous test');
  }
}

// ---------------------------------------------------------------------------
// [API-06]  GET article returns tier + adEnabled
// ---------------------------------------------------------------------------

console.log('\n── Article Response Fields ──');

if (freeSlug) {
  const res = await apiFetch(`/api/articles/${freeSlug}`);
  t.ok(res.ok, '[API-06a] GET free article → 200');
  t.equal(res.body?.meta?.tier, 'free', '[API-06b] meta.tier = "free"');
  t.equal(res.body?.meta?.adEnabled, true, '[API-06c] meta.adEnabled = true for free');
}

if (paidSlug) {
  const res = await apiFetch(`/api/articles/${paidSlug}`);
  t.ok(res.ok, '[API-06d] GET paid article → 200');
  t.equal(res.body?.meta?.tier, 'paid', '[API-06e] meta.tier = "paid"');
  t.equal(res.body?.meta?.adEnabled, false, '[API-06f] meta.adEnabled = false for paid');
}

// ---------------------------------------------------------------------------
// [API-07..08]  View tracking
// ---------------------------------------------------------------------------

console.log('\n── View Tracking ──');

if (freeSlug) {
  // [API-07] First view → 200
  {
    const res = await apiFetch(`/api/articles/${freeSlug}/view`, {
      method: 'POST',
      headers: { 'X-Visitor-Id': 'qa-test-visitor-unique-001' },
    });
    t.ok(res.ok, '[API-07] POST /view → 200', { status: res.status, body: res.body });
    t.ok(typeof res.body?.recorded !== 'undefined', '[API-07b] Response includes recorded field');
    t.equal(res.body?.recorded, true, '[API-07c] First view is counted');
  }

  // [API-08] Same visitor same day → deduplicated
  {
    const res = await apiFetch(`/api/articles/${freeSlug}/view`, {
      method: 'POST',
      headers: { 'X-Visitor-Id': 'qa-test-visitor-unique-001' },
    });
    t.ok(res.ok, '[API-08] POST /view again → 200 (not 4xx)', { status: res.status });
    t.equal(res.body?.recorded, false, '[API-08b] Duplicate view is NOT counted (deduplicated)');
  }

  // Different visitor → new count
  {
    const res = await apiFetch(`/api/articles/${freeSlug}/view`, {
      method: 'POST',
      headers: { 'X-Visitor-Id': 'qa-test-visitor-unique-002' },
    });
    t.ok(res.ok, '[API-08c] Different visitor view → 200');
    t.equal(res.body?.recorded, true, '[API-08d] Different visitor view IS counted');
  }
}

// ---------------------------------------------------------------------------
// [API-12]  Internal lifecycle endpoint
// ---------------------------------------------------------------------------

console.log('\n── Internal Lifecycle ──');

if (freeSlug) {
  const res = await apiFetch(`/api/internal/lifecycle/${freeSlug}`);
  if (res.status === 404 || res.status === 501) {
    if (STRICT_PHASE1) {
      t.ok(false, '[API-12] GET /internal/lifecycle/:slug is required in strict mode', {
        status: res.status,
        body: res.body,
      });
    } else {
      t.skip('[API-12] GET /internal/lifecycle/:slug', 'endpoint not implemented yet');
    }
  } else {
    t.ok(res.ok, '[API-12] GET /internal/lifecycle/:slug → 200', { status: res.status });
    t.ok(typeof res.body?.status === 'string', '[API-12b] Response has status field');
    t.ok(['published', 'at_risk', 'expired'].includes(res.body?.status),
      '[API-12c] Status is valid lifecycle value', { status: res.body?.status });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const allPassed = t.summary();
process.exit(allPassed ? 0 : 1);
