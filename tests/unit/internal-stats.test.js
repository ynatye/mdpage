import test from 'node:test';
import assert from 'node:assert/strict';
import { computeInternalStats } from '../../lib/stats.js';

test('[ST-01] computes base totals by status + tier', () => {
  const index = {
    a: { slug: 'a', status: 'published', tier: 'free', last30dUniqueViews: 2 },
    b: { slug: 'b', status: 'at_risk', tier: 'free', last30dUniqueViews: 5, expiresAt: '2026-02-20T00:00:00.000Z' },
    c: { slug: 'c', status: 'expired', tier: 'paid', last30dUniqueViews: 1 },
  };

  const stats = computeInternalStats(index, [], '2026-02-18T00:00:00.000Z');

  assert.equal(stats.total, 3);
  assert.equal(stats.published, 1);
  assert.equal(stats.at_risk, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.free, 2);
  assert.equal(stats.paid, 1);
});

test('[ST-02] rolls up transition counters from last 24h runs', () => {
  const runs = [
    {
      ts: '2026-02-17T23:00:00.000Z',
      transitions: { at_risk: 2, recovered: 1, expired: 0 },
    },
    {
      ts: '2026-02-16T22:00:00.000Z',
      transitions: { at_risk: 10, recovered: 10, expired: 10 },
    },
  ];

  const stats = computeInternalStats({}, runs, '2026-02-18T00:00:00.000Z');

  assert.deepEqual(stats.transitions24h, {
    at_risk: 2,
    recovered: 1,
    expired: 0,
  });
  assert.equal(stats.lastLifecycleRunAt, '2026-02-17T23:00:00.000Z');
});

test('[ST-03] includes expiringSoon and sorts by daysRemaining', () => {
  const index = {
    risk1: {
      slug: 'risk1',
      title: 'Risk One',
      status: 'at_risk',
      tier: 'free',
      expiresAt: '2026-02-19T00:00:00.000Z',
    },
    risk2: {
      slug: 'risk2',
      title: 'Risk Two',
      status: 'at_risk',
      tier: 'free',
      expiresAt: '2026-02-25T00:00:00.000Z',
    },
    stable: {
      slug: 'stable',
      status: 'published',
      tier: 'free',
    },
  };

  const stats = computeInternalStats(index, [], '2026-02-18T00:00:00.000Z');

  assert.equal(stats.expiringSoon.length, 2);
  assert.equal(stats.expiringSoon[0].slug, 'risk1');
  assert.equal(stats.expiringSoon[0].daysRemaining, 1);
  assert.equal(stats.expiringSoon[1].slug, 'risk2');
  assert.equal(stats.expiringSoon[1].daysRemaining, 7);
});

test('[ST-04] returns topPosts30d sorted desc and capped at 10', () => {
  const index = {};
  for (let i = 0; i < 12; i++) {
    index[`s${i}`] = {
      slug: `s${i}`,
      title: `Post ${i}`,
      status: 'published',
      tier: 'free',
      last30dUniqueViews: i,
    };
  }

  const stats = computeInternalStats(index, [], '2026-02-18T00:00:00.000Z');
  assert.equal(stats.topPosts30d.length, 10);
  assert.equal(stats.topPosts30d[0].slug, 's11');
  assert.equal(stats.topPosts30d[9].slug, 's2');
});

// ── Day 3 — richer metrics ────────────────────────────────────────────────────

test('[ST-05] totalViews sums all-time views across all articles', () => {
  const index = {
    a: { slug: 'a', status: 'published', tier: 'free',  totalViews: 100, last30dUniqueViews: 5 },
    b: { slug: 'b', status: 'published', tier: 'paid',  totalViews: 50,  last30dUniqueViews: 0 },
    c: { slug: 'c', status: 'expired',   tier: 'free',  totalViews: 25,  last30dUniqueViews: 0 },
    d: { slug: 'd', status: 'published', tier: 'free',  /* missing */    last30dUniqueViews: 0 },
  };
  const stats = computeInternalStats(index, [], '2026-02-18T00:00:00.000Z');
  assert.equal(stats.totalViews, 175); // missing totalViews treated as 0
});

test('[ST-06] publishedLast7d counts articles created in the last 7 days', () => {
  const now = '2026-02-18T12:00:00.000Z';
  const index = {
    recent1: { slug: 'recent1', status: 'published', tier: 'free', createdAt: '2026-02-16T00:00:00.000Z', last30dUniqueViews: 0 },
    recent2: { slug: 'recent2', status: 'published', tier: 'paid', createdAt: '2026-02-12T12:00:00.000Z', last30dUniqueViews: 0 }, // exactly 6d
    old:     { slug: 'old',     status: 'published', tier: 'free', createdAt: '2026-02-01T00:00:00.000Z', last30dUniqueViews: 0 },
  };
  const stats = computeInternalStats(index, [], now);
  assert.equal(stats.publishedLast7d, 2); // recent1 and recent2 within 7*24h window
});

test('[ST-07] zeroViewsCount counts active free articles with no 30d views', () => {
  const index = {
    free_zero:    { slug: 'fz',  status: 'published', tier: 'free',  last30dUniqueViews: 0 },  // counted
    free_views:   { slug: 'fv',  status: 'published', tier: 'free',  last30dUniqueViews: 5 },  // has views, skip
    free_expired: { slug: 'fe',  status: 'expired',   tier: 'free',  last30dUniqueViews: 0 },  // expired, skip
    paid_zero:    { slug: 'pz',  status: 'published', tier: 'paid',  last30dUniqueViews: 0 },  // paid, skip
    risk_zero:    { slug: 'rz',  status: 'at_risk',   tier: 'free',  last30dUniqueViews: 0 },  // at_risk is not expired, counted
  };
  const stats = computeInternalStats(index, [], '2026-02-18T00:00:00.000Z');
  assert.equal(stats.zeroViewsCount, 2); // free_zero + risk_zero
});

test('[ST-08] lifecycleRunHistory returns last 10 runs, most recent first', () => {
  const runs = Array.from({ length: 15 }, (_, i) => ({
    ts:          `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    evaluated:   i,
    transitions: { at_risk: 1, recovered: 0, expired: 0 },
    errors:      0,
  }));

  const stats = computeInternalStats({}, runs, '2026-02-18T00:00:00.000Z');

  assert.equal(stats.lifecycleRunHistory.length, 10);
  // Most recent first: index 14 → Feb 15, index 13 → Feb 14, … index 5 → Feb 06
  assert.equal(stats.lifecycleRunHistory[0].ts, '2026-02-15T00:00:00.000Z');
  assert.equal(stats.lifecycleRunHistory[9].ts, '2026-02-06T00:00:00.000Z');
  // Shape check on first entry
  const first = stats.lifecycleRunHistory[0];
  assert.ok('ts' in first && 'evaluated' in first);
  assert.ok('at_risk' in first && 'recovered' in first && 'expired' in first && 'errors' in first);
});

test('[ST-09] sweepCount24h counts only runs within the last 24 hours', () => {
  const now = '2026-02-18T12:00:00.000Z';
  const runs = [
    { ts: '2026-02-18T10:00:00.000Z', transitions: {}, errors: 0 }, // 2h ago — in window
    { ts: '2026-02-17T13:00:00.000Z', transitions: {}, errors: 0 }, // ~23h ago — in window
    { ts: '2026-02-17T11:00:00.000Z', transitions: {}, errors: 0 }, // ~25h ago — outside
    { ts: '2026-02-16T00:00:00.000Z', transitions: {}, errors: 0 }, // old — outside
  ];
  const stats = computeInternalStats({}, runs, now);
  assert.equal(stats.sweepCount24h, 2);
});

test('[ST-10] lifecycleRunHistory shapes each entry with transition sub-fields', () => {
  const runs = [
    {
      ts:          '2026-02-18T00:00:00.000Z',
      evaluated:   5,
      transitions: { at_risk: 2, recovered: 1, expired: 0 },
      errors:      3,
    },
  ];
  const stats = computeInternalStats({}, runs, '2026-02-18T00:00:00.000Z');
  assert.equal(stats.lifecycleRunHistory.length, 1);
  const r = stats.lifecycleRunHistory[0];
  assert.equal(r.evaluated, 5);
  assert.equal(r.at_risk,   2);
  assert.equal(r.recovered, 1);
  assert.equal(r.expired,   0);
  assert.equal(r.errors,    3);
});
