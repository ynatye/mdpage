#!/usr/bin/env node
/**
 * scripts/health-check.js — Morning validation / smoke check
 *
 * Verifies the running server is healthy and all core endpoints respond.
 *
 * Usage:
 *   node scripts/health-check.js
 *   SERVER_URL=http://your-server:3456 node scripts/health-check.js
 *
 * Exit codes:
 *   0  All checks passed
 *   1  One or more checks failed
 */

const BASE = process.env.SERVER_URL ?? 'http://localhost:3456';

let passed = 0;
let failed = 0;

async function check(label, fn) {
  try {
    const result = await fn();
    if (result.ok) {
      console.log(`  ✓  ${label}`);
      passed++;
    } else {
      console.error(`  ✗  ${label}`);
      if (result.detail) console.error(`       ${result.detail}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

async function post(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

// ── Preflight ────────────────────────────────────────────────────────────────

console.log(`\nmdpage health check → ${BASE}\n`);

try {
  await fetch(`${BASE}/healthz`);
} catch {
  console.error(`✗ Server unreachable at ${BASE}`);
  console.error('  Start the server: node server.js\n');
  process.exit(1);
}

// ── Liveness ─────────────────────────────────────────────────────────────────

console.log('── Liveness ──');

await check('GET /healthz → { status: "ok" }', async () => {
  const r = await get('/healthz');
  return { ok: r.ok && r.body?.status === 'ok' };
});

// ── Configuration ─────────────────────────────────────────────────────────────

console.log('\n── Configuration ──');

await check('GET /api/internal/config → lifecycle thresholds present', async () => {
  const r = await get('/api/internal/config');
  const lc = r.body?.lifecycle;
  return {
    ok: r.ok && lc?.MIN_AGE_DAYS != null && lc?.UNIQUE_VIEW_THRESHOLD != null,
    detail: !r.ok ? `HTTP ${r.status}` : undefined,
  };
});

await check('GET /api/internal/stats → total count field present', async () => {
  const r = await get('/api/internal/stats');
  return {
    ok: r.ok && typeof r.body?.total === 'number',
    detail: !r.ok ? `HTTP ${r.status}` : undefined,
  };
});

// ── Publish ───────────────────────────────────────────────────────────────────

console.log('\n── Publish ──');

let slug;

await check('POST /api/publish (free) → 201 + slug', async () => {
  const r = await post('/api/publish', {
    markdown: `# Health Check ${Date.now()}\n\nSmoke test article.`,
    tier: 'free',
  });
  slug = r.body?.slug;
  return {
    ok: r.status === 201 && typeof slug === 'string',
    detail: !r.ok ? `HTTP ${r.status}: ${JSON.stringify(r.body)}` : undefined,
  };
});

await check('POST /api/publish — missing markdown → 400', async () => {
  const r = await post('/api/publish', { tier: 'free', markdown: '' });
  return { ok: r.status === 400 };
});

await check('POST /api/publish — no title → 400', async () => {
  const r = await post('/api/publish', { tier: 'free', markdown: 'no title here' });
  return { ok: r.status === 400 };
});

// ── Article fetch ─────────────────────────────────────────────────────────────

console.log('\n── Article fetch ──');

if (slug) {
  await check(`GET /api/articles/${slug} → 200 + meta`, async () => {
    const r = await get(`/api/articles/${slug}`);
    return {
      ok: r.ok && r.body?.title && r.body?.meta?.slug === slug,
      detail: !r.ok ? `HTTP ${r.status}` : undefined,
    };
  });

  await check(`POST /api/articles/${slug}/view → 200`, async () => {
    const r = await post(`/api/articles/${slug}/view`, {});
    return { ok: r.ok };
  });
}

await check('GET /api/articles/nonexistent-slug-xyz → 404', async () => {
  const r = await get('/api/articles/nonexistent-health-check-slug-xyz');
  return { ok: r.status === 404 };
});

// ── Summary ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
console.log('');

if (failed > 0) {
  console.error('Health check FAILED. Check the errors above.\n');
  process.exit(1);
}

const stats = await get('/api/internal/stats').then(r => r.body).catch(() => ({}));
console.log(`Articles: ${stats.total ?? '?'} total — ${stats.published ?? '?'} published, ${stats.at_risk ?? '?'} at-risk, ${stats.expired ?? '?'} expired`);
console.log('Server is healthy. ✓\n');
process.exit(0);
