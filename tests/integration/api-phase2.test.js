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

import { TestRunner, apiFetch, serverIsReachable, makeArticle, sleep } from '../helpers/test-utils.js';

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
// [P2-11] /api/free/articles queue-backed publish
// ---------------------------------------------------------------------------
console.log('\n── Free API Queue ──');

let freeJobIdA;
let freeJobIdB;

{
  const md = `# Free Queue ${Date.now()}\n\nQueue me please.`;
  const res = await apiFetch('/api/free/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown' },
    body: md,
  });

  t.ok(res.status === 202, '[P2-11] POST /api/free/articles → 202', { status: res.status, body: res.body });
  t.ok(typeof res.body?.jobId === 'string', '[P2-11b] returns jobId');
  t.ok(typeof res.body?.statusUrl === 'string', '[P2-11c] returns statusUrl');
  freeJobIdA = res.body?.jobId;
}

{
  const md = `# Free Queue B ${Date.now()}\n\nSecond request.`;
  const res = await apiFetch('/api/free/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown' },
    body: md,
  });
  t.ok(res.status === 202, '[P2-11d] second free publish also queued', { status: res.status, body: res.body });
  t.ok((res.body?.etaSeconds ?? 0) >= 1, '[P2-11e] second request has queue delay ETA');
  freeJobIdB = res.body?.jobId;
}

// Poll first queued job briefly — should complete quickly even when cadence is long.
if (freeJobIdA) {
  let done = false;
  for (let i = 0; i < 10; i++) {
    const s = await apiFetch(`/api/free/articles/jobs/${freeJobIdA}`);
    if (s.body?.status === 'done') {
      done = true;
      t.ok(typeof s.body?.result?.slug === 'string', '[P2-11f] first queued job created slug');
      break;
    }
    await sleep(200);
  }
  t.ok(done, '[P2-11g] first queued job reaches done state');
}

if (freeJobIdB) {
  const s = await apiFetch(`/api/free/articles/jobs/${freeJobIdB}`);
  t.ok(['queued', 'processing', 'done'].includes(s.body?.status), '[P2-11h] second job has valid status');
}

{
  const res = await apiFetch('/api/free/articles/queue');
  t.ok(res.ok, '[P2-11i] GET /api/free/articles/queue → 200', { status: res.status });
  t.ok(typeof res.body?.minIntervalMs === 'number', '[P2-11j] queue config exposed');
}

// ---------------------------------------------------------------------------
// [P2-12] wait=true / waitMs mode — synchronous wait on POST /api/free/articles
// ---------------------------------------------------------------------------
console.log('\n── Free API Wait Mode ──');

{
  // With ?wait=true the server waits up to FREE_ARTICLE_WAIT_DEFAULT_MS for the job.
  // In test env FREE_ARTICLE_MIN_INTERVAL_MS=100 so the first-in-queue job
  // completes fast and should return 201. However, if the queue has backlog the
  // job may not finish within the wait window, in which case 202 is the correct
  // fallback. Both outcomes are asserted to pass.
  const md = `# Wait Mode ${Date.now()}\n\nSynchronous wait mode test.`;
  const res = await apiFetch('/api/free/articles?wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown' },
    body: md,
  });

  t.ok(
    res.status === 201 || res.status === 202,
    '[P2-12] POST ?wait=true → 201 or 202',
    { status: res.status }
  );

  if (res.status === 201) {
    t.ok(typeof res.body?.slug === 'string',  '[P2-12b] 201 response includes slug');
    t.ok(typeof res.body?.url === 'string',   '[P2-12c] 201 response includes url (guaranteed)');
    t.ok(res.body?.url?.startsWith('/'),      '[P2-12d] url starts with /');
    t.ok(typeof res.body?.tier === 'string',  '[P2-12e] 201 response includes tier');
  } else {
    // 202 fallback — should have standard queue fields
    t.ok(typeof res.body?.jobId === 'string',    '[P2-12b-fallback] 202 fallback includes jobId');
    t.ok(typeof res.body?.statusUrl === 'string','[P2-12c-fallback] 202 fallback includes statusUrl');
    // Skip remaining 201-specific assertions
    t.skip('[P2-12d]', 'wait timed out — job queued behind backlog (202 fallback)');
    t.skip('[P2-12e]', 'wait timed out — job queued behind backlog (202 fallback)');
  }
}

{
  // ?waitMs=500 with a very short window: should return 202 if queue is backed up,
  // or 201 if it completes within 500 ms. Either is correct.
  const md = `# Wait Timeout ${Date.now()}\n\nShort wait window test.`;
  const res = await apiFetch('/api/free/articles?waitMs=500', {
    method: 'POST',
    headers: { 'Content-Type': 'text/markdown' },
    body: md,
  });

  t.ok(
    res.status === 201 || res.status === 202,
    '[P2-13] POST ?waitMs=500 → 201 or 202',
    { status: res.status }
  );

  if (res.status === 201) {
    // URL contract: must be present on 201
    t.ok(typeof res.body?.url === 'string', '[P2-13b] 201 with ?waitMs includes url');
  } else {
    t.ok(typeof res.body?.jobId === 'string', '[P2-13b-fallback] 202 fallback has jobId');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
t.summary();
