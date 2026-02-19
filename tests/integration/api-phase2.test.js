/**
 * tests/integration/api-phase2.test.js
 *
 * Integration tests for Phase 2 API contracts.
 * Requires a running server at SERVER_URL (default: http://localhost:3456).
 *
 * Coverage:
 *   [P2-01]  GET  /api/articles/:slug — includes lifecycleUx field
 *   [P2-02]  GET  /api/articles/:slug/status — 200 with slug/status/tier/lifecycleUx
 *   [P2-03]  GET  /api/articles/:slug/status — 404 for unknown slug
 *   [P2-04]  POST /api/checkout/session — validates slug field
 *   [P2-05]  POST /api/checkout/session — 404 for unknown slug
 *   [P2-06]  POST /api/checkout/session — valid slug returns sessionId + url
 *   [P2-07]  GET  /api/checkout/status/:slug — returns billing fields
 *   [P2-08]  POST /api/webhooks/stripe — stub mode returns { received: true, skipped: true }
 *   [P2-09]  GET  /api/internal/billing-config — auth'd, returns readiness
 *   [P2-10]  GET  /api/internal/abuse — auth'd, returns log + config
 */

import { TestRunner, apiFetch, serverIsReachable, makeArticle } from '../helpers/test-utils.js';

const t = new TestRunner('API Phase 2 Integration');

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
const reachable = await serverIsReachable();
if (!reachable) {
  console.error('\n✗ Server not reachable. Start with: npm run test:integration\n');
  process.exit(1);
}

console.log('\n[API Phase 2 Integration Tests]\n');

// ---------------------------------------------------------------------------
// Publish a free article to use in tests
// ---------------------------------------------------------------------------
let testSlug;
{
  const res = await apiFetch('/api/publish', {
    method: 'POST',
    body: JSON.stringify(makeArticle({ title: `P2 Test ${Date.now()}`, tier: 'free' })),
  });
  testSlug = res.body?.slug;
  t.ok(testSlug, '[P2-setup] Published test article', { slug: testSlug });
}

// ---------------------------------------------------------------------------
// [P2-01]  GET /api/articles/:slug — lifecycleUx field
// ---------------------------------------------------------------------------
console.log('── Article Response ──');

{
  const res = await apiFetch(`/api/articles/${testSlug}`);
  t.ok(res.ok, '[P2-01] GET article → 200', { status: res.status });
  t.ok(typeof res.body?.lifecycleUx === 'object' && res.body.lifecycleUx !== null,
    '[P2-01b] Response includes lifecycleUx object');
  t.ok(['published', 'at_risk', 'expired'].includes(res.body?.lifecycleUx?.status),
    '[P2-01c] lifecycleUx.status is valid');
  t.ok(typeof res.body?.lifecycleUx?.statusLabel === 'string',
    '[P2-01d] lifecycleUx.statusLabel is a string');
  t.ok(['critical', 'high', 'medium', 'low'].includes(res.body?.lifecycleUx?.urgency),
    '[P2-01e] lifecycleUx.urgency is valid');
  t.ok('daysLeft' in res.body?.lifecycleUx,
    '[P2-01f] lifecycleUx.daysLeft field present (may be null)');
  t.ok(typeof res.body?.lifecycleUx?.daysLeftText === 'string',
    '[P2-01g] lifecycleUx.daysLeftText is a string');
}

// ---------------------------------------------------------------------------
// [P2-02/P2-03]  GET /api/articles/:slug/status
// ---------------------------------------------------------------------------
console.log('\n── Status Endpoint ──');

{
  const res = await apiFetch(`/api/articles/${testSlug}/status`);
  t.ok(res.ok, '[P2-02] GET /status → 200', { status: res.status });
  t.ok(res.body?.slug === testSlug, '[P2-02b] slug matches');
  t.ok(['published', 'at_risk', 'expired'].includes(res.body?.status),
    '[P2-02c] status is valid lifecycle value');
  t.ok(['free', 'paid'].includes(res.body?.tier), '[P2-02d] tier is valid');
  t.ok(typeof res.body?.lifecycleUx === 'object', '[P2-02e] lifecycleUx present');
}

{
  const res = await apiFetch('/api/articles/this-slug-definitely-does-not-exist-p2/status');
  t.ok(res.status === 404, '[P2-03] Unknown slug /status → 404', { status: res.status });
}

// ---------------------------------------------------------------------------
// [P2-04/P2-05/P2-06]  POST /api/checkout/session
// ---------------------------------------------------------------------------
console.log('\n── Checkout Session ──');

{
  const res = await apiFetch('/api/checkout/session', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  t.ok(res.status === 400, '[P2-04] Missing slug → 400', { status: res.status });
}

{
  const res = await apiFetch('/api/checkout/session', {
    method: 'POST',
    body: JSON.stringify({ slug: 'slug-that-does-not-exist-p2qa' }),
  });
  t.ok(res.status === 404, '[P2-05] Unknown slug → 404', { status: res.status });
}

let checkoutSessionId;
{
  const res = await apiFetch('/api/checkout/session', {
    method: 'POST',
    body: JSON.stringify({ slug: testSlug }),
  });
  t.ok(res.ok, '[P2-06] Valid slug → 200', { status: res.status, body: res.body });
  t.ok(typeof res.body?.sessionId === 'string', '[P2-06b] sessionId is a string');
  t.ok(typeof res.body?.url === 'string', '[P2-06c] url is a string');
  t.ok(typeof res.body?.stub === 'boolean', '[P2-06d] stub flag is boolean');
  t.ok(typeof res.body?.provider === 'string', '[P2-06e] provider is a string');
  t.ok(typeof res.body?.amountCents === 'number', '[P2-06f] amountCents is a number');
  checkoutSessionId = res.body?.sessionId;
}

// Duplicate session check (should 409 now that article is pending)
{
  const res = await apiFetch('/api/checkout/session', {
    method: 'POST',
    body: JSON.stringify({ slug: testSlug }),
  });
  t.ok(res.status === 409, '[P2-06g] Duplicate session → 409', { status: res.status });
}

// ---------------------------------------------------------------------------
// [P2-07]  GET /api/checkout/status/:slug
// ---------------------------------------------------------------------------
console.log('\n── Checkout Status ──');

{
  const res = await apiFetch(`/api/checkout/status/${testSlug}`);
  t.ok(res.ok, '[P2-07] GET /checkout/status/:slug → 200', { status: res.status });
  t.ok(res.body?.slug === testSlug, '[P2-07b] slug matches');
  t.ok(typeof res.body?.billingStatus === 'string', '[P2-07c] billingStatus is string');
  t.ok('checkoutSessionId' in res.body, '[P2-07d] checkoutSessionId field present');
}

// ---------------------------------------------------------------------------
// [P2-08]  POST /api/webhooks/stripe (stub mode)
// ---------------------------------------------------------------------------
console.log('\n── Webhook (stub mode) ──');

{
  const res = await apiFetch('/api/webhooks/stripe', {
    method: 'POST',
    body: JSON.stringify({ type: 'checkout.session.completed' }),
  });
  // In stub mode (BILLING_PROVIDER=none) always 200 with skipped=true
  t.ok(res.ok, '[P2-08] POST /webhooks/stripe → 200 (stub)', { status: res.status });
  t.ok(res.body?.received === true, '[P2-08b] received=true');
  t.ok(res.body?.skipped === true, '[P2-08c] skipped=true in stub mode');
}

// ---------------------------------------------------------------------------
// [P2-09]  GET /api/internal/billing-config (requires no token in test env)
// ---------------------------------------------------------------------------
console.log('\n── Internal: Billing Config ──');

{
  const res = await apiFetch('/api/internal/billing-config');
  if (res.status === 401) {
    t.ok(true, '[P2-09] billing-config auth required (token not set in this test run) — skip content check');
  } else {
    t.ok(res.ok, '[P2-09] GET /api/internal/billing-config → 200', { status: res.status });
    t.ok(typeof res.body?.provider === 'string', '[P2-09b] provider field present');
    t.ok(Array.isArray(res.body?.issues), '[P2-09c] issues array present');
    t.ok(typeof res.body?.ready === 'boolean', '[P2-09d] ready flag present');
  }
}

// ---------------------------------------------------------------------------
// [P2-10]  GET /api/internal/abuse (requires no token in test env)
// ---------------------------------------------------------------------------
console.log('\n── Internal: Abuse Log ──');

{
  const res = await apiFetch('/api/internal/abuse');
  if (res.status === 401) {
    t.ok(true, '[P2-10] abuse endpoint auth required — skip content check');
  } else {
    t.ok(res.ok, '[P2-10] GET /api/internal/abuse → 200', { status: res.status });
    t.ok(typeof res.body?.blockListSize === 'number', '[P2-10b] blockListSize present');
    t.ok(Array.isArray(res.body?.log), '[P2-10c] log array present');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
t.summary();
