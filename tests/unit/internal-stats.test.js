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
