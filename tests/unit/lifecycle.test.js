/**
 * tests/unit/lifecycle.test.js
 *
 * Validates the Phase 1 lifecycle state machine per PRD §"Content Lifecycle (Free Posts)".
 *
 * Coverage:
 *   [LC-01]  Young healthy post stays published
 *   [LC-02]  Old healthy post (good traffic) stays published
 *   [LC-03]  Old post with low traffic → at_risk
 *   [LC-04]  at_risk post with recovered traffic → published (recovery)
 *   [LC-05]  at_risk post still low traffic, in window → stays at_risk
 *   [LC-06]  at_risk post passes expiresAt with low traffic → expired
 *   [LC-07]  expired post is terminal (no transitions out)
 *   [LC-08]  Paid posts are NEVER evaluated (always return current status)
 *   [LC-09]  atRiskStartedAt and expiresAt fields set correctly on transition
 *   [LC-10]  Recovery clears atRiskStartedAt and expiresAt
 *   [LC-11]  Batch evaluator runs over multiple posts correctly
 *   [LC-12]  countdownDaysRemaining() returns correct days
 *   [LC-13]  Exactly-at-threshold (10 views) stays published
 *   [LC-14]  Exactly 30 days old evaluates; 29 days stays published
 *
 * Run: node --test tests/unit/lifecycle.test.js
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  evaluateLifecycle,
  runLifecycleBatch,
  countdownDaysRemaining,
  STATUS,
  THRESHOLDS,
} from '../helpers/lifecycle-machine.js';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Create a date N days ago from `now`. */
function daysAgo(n, now = new Date()) {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
}

/** Build a minimal free post object. */
function freePost({
  slug = 'test-post-abc12345x',
  createdAt,
  status = STATUS.PUBLISHED,
  atRiskStartedAt = null,
  expiresAt = null,
} = {}) {
  return {
    slug,
    tier: 'free',
    status,
    createdAt: (createdAt ?? daysAgo(35)).toISOString(),
    atRiskStartedAt,
    expiresAt,
  };
}

/** Build a minimal paid post object. */
function paidPost({ status = STATUS.PUBLISHED } = {}) {
  return {
    slug: 'clean-paid-slug',
    tier: 'paid',
    status,
    createdAt: daysAgo(90).toISOString(),
    atRiskStartedAt: null,
    expiresAt: null,
  };
}

// ---------------------------------------------------------------------------
// [LC-01..02]  Healthy published posts
// ---------------------------------------------------------------------------
describe('[LC-01..02] Healthy published posts stay published', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-01] Young post (< 30 days) with low traffic stays published', () => {
    const post = freePost({ createdAt: daysAgo(10, NOW) });
    const result = evaluateLifecycle(post, 0 /* zero views */, NOW);
    assert.equal(result.status, STATUS.PUBLISHED);
  });

  test('[LC-02] Old post (> 30 days) with good traffic stays published', () => {
    const post = freePost({ createdAt: daysAgo(45, NOW) });
    const result = evaluateLifecycle(post, THRESHOLDS.VIEW_THRESHOLD /* exactly 10 */, NOW);
    assert.equal(result.status, STATUS.PUBLISHED);
  });
});

// ---------------------------------------------------------------------------
// [LC-03]  published → at_risk transition
// ---------------------------------------------------------------------------
describe('[LC-03] published → at_risk transition', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-03] Old post with low traffic transitions to at_risk', () => {
    const post = freePost({ createdAt: daysAgo(35, NOW) });
    const result = evaluateLifecycle(post, 5 /* below 10 */, NOW);
    assert.equal(result.status, STATUS.AT_RISK);
  });

  test('[LC-09a] atRiskStartedAt is set on transition', () => {
    const post = freePost({ createdAt: daysAgo(35, NOW) });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.ok(result.atRiskStartedAt, 'atRiskStartedAt should be set');
    assert.equal(result.atRiskStartedAt, NOW.toISOString());
  });

  test('[LC-09b] expiresAt is set to atRiskStartedAt + 7 days', () => {
    const post = freePost({ createdAt: daysAgo(35, NOW) });
    const result = evaluateLifecycle(post, 0, NOW);
    const expectedExpiry = new Date(NOW.getTime() + THRESHOLDS.WARNING_DAYS * 86400000).toISOString();
    assert.equal(result.expiresAt, expectedExpiry);
  });
});

// ---------------------------------------------------------------------------
// [LC-04]  at_risk → published (recovery)
// ---------------------------------------------------------------------------
describe('[LC-04] at_risk → published recovery', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-04] at_risk with recovered traffic reverts to published', () => {
    const riskStart = daysAgo(3, NOW);
    const post = freePost({
      createdAt: daysAgo(40, NOW),
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    // Traffic has recovered to exactly the threshold
    const result = evaluateLifecycle(post, THRESHOLDS.VIEW_THRESHOLD, NOW);
    assert.equal(result.status, STATUS.PUBLISHED);
  });

  test('[LC-10] Recovery clears atRiskStartedAt and expiresAt', () => {
    const riskStart = daysAgo(3, NOW);
    const post = freePost({
      createdAt: daysAgo(40, NOW),
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    const result = evaluateLifecycle(post, 15, NOW);
    assert.equal(result.atRiskStartedAt, null);
    assert.equal(result.expiresAt, null);
  });
});

// ---------------------------------------------------------------------------
// [LC-05..06]  at_risk stays or expires
// ---------------------------------------------------------------------------
describe('[LC-05..06] at_risk → stays at_risk or → expired', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-05] at_risk with low traffic, within window → stays at_risk', () => {
    const riskStart = daysAgo(3, NOW);  // 3 days into 7-day window
    const post = freePost({
      createdAt: daysAgo(40, NOW),
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.AT_RISK);
  });

  test('[LC-06] at_risk with low traffic, past expiresAt → expired', () => {
    const riskStart = daysAgo(10, NOW);  // 10 days ago — past 7-day window
    const post = freePost({
      createdAt: daysAgo(50, NOW),
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.EXPIRED);
  });
});

// ---------------------------------------------------------------------------
// [LC-07]  Expired is terminal
// ---------------------------------------------------------------------------
describe('[LC-07] Expired state is terminal', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-07] Expired post with massive traffic stays expired', () => {
    const post = freePost({
      createdAt: daysAgo(60, NOW),
      status: STATUS.EXPIRED,
    });
    const result = evaluateLifecycle(post, 9999, NOW);
    assert.equal(result.status, STATUS.EXPIRED);
  });
});

// ---------------------------------------------------------------------------
// [LC-08]  Paid posts skip evaluation
// ---------------------------------------------------------------------------
describe('[LC-08] Paid posts are never evaluated', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-08a] Old paid post with zero views stays published', () => {
    const post = paidPost({ status: STATUS.PUBLISHED });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.PUBLISHED);
  });

  test('[LC-08b] Paid post in any state returns that state unchanged', () => {
    // Even if somehow marked at_risk, paid post is not re-evaluated
    const post = { ...paidPost(), status: STATUS.AT_RISK };
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.AT_RISK);
  });
});

// ---------------------------------------------------------------------------
// [LC-11]  Batch evaluator
// ---------------------------------------------------------------------------
describe('[LC-11] Batch lifecycle evaluator', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-11] Batch processes mixed posts correctly', () => {
    const posts = [
      { slug: 'young-free',    tier: 'free', status: 'published', createdAt: daysAgo(10, NOW).toISOString() },
      { slug: 'old-low',       tier: 'free', status: 'published', createdAt: daysAgo(40, NOW).toISOString() },
      { slug: 'paid-post',     tier: 'paid', status: 'published', createdAt: daysAgo(90, NOW).toISOString() },
    ];

    const viewMap = {
      'young-free': 0,    // young — should stay published
      'old-low': 2,       // old + low → at_risk
      'paid-post': 0,     // paid — skip
    };

    const results = runLifecycleBatch(posts, (slug) => viewMap[slug] ?? 0, NOW);

    const bySlug = Object.fromEntries(results.map((r) => [r.slug, r]));

    assert.equal(bySlug['young-free'].after, STATUS.PUBLISHED,  'Young post stays published');
    assert.equal(bySlug['old-low'].after, STATUS.AT_RISK,       'Old+low → at_risk');
    assert.equal(bySlug['paid-post'].after, STATUS.PUBLISHED,   'Paid post unchanged');
    assert.equal(bySlug['old-low'].changed, true,               'old-low changed flag');
    assert.equal(bySlug['paid-post'].changed, false,            'paid-post not changed');
  });
});

// ---------------------------------------------------------------------------
// [LC-12]  countdownDaysRemaining()
// ---------------------------------------------------------------------------
describe('[LC-12] Countdown days remaining', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-12a] Returns null for published post', () => {
    const post = freePost();
    assert.equal(countdownDaysRemaining(post, NOW), null);
  });

  test('[LC-12b] Returns correct days for at_risk post', () => {
    const riskStart = daysAgo(3, NOW);  // 3 days in → 4 days left
    const post = freePost({
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    const days = countdownDaysRemaining(post, NOW);
    assert.equal(days, 4, `Expected 4 days remaining, got ${days}`);
  });

  test('[LC-12c] Returns 0 when already past expiresAt', () => {
    const riskStart = daysAgo(10, NOW);
    const post = freePost({
      status: STATUS.AT_RISK,
      atRiskStartedAt: riskStart.toISOString(),
      expiresAt: new Date(riskStart.getTime() + 7 * 86400000).toISOString(),
    });
    const days = countdownDaysRemaining(post, NOW);
    assert.equal(days, 0);
  });
});

// ---------------------------------------------------------------------------
// [LC-13..14]  Edge cases — boundary conditions
// ---------------------------------------------------------------------------
describe('[LC-13..14] Boundary conditions', () => {
  const NOW = new Date('2026-02-18T00:00:00Z');

  test('[LC-13] Exactly VIEW_THRESHOLD views → stays published (not at_risk)', () => {
    const post = freePost({ createdAt: daysAgo(40, NOW) });
    const result = evaluateLifecycle(post, THRESHOLDS.VIEW_THRESHOLD, NOW);
    assert.equal(result.status, STATUS.PUBLISHED, 'Exactly 10 views is above threshold');
  });

  test('[LC-14a] Exactly 30 days old + low traffic → at_risk', () => {
    const post = freePost({ createdAt: daysAgo(THRESHOLDS.MIN_AGE_DAYS, NOW) });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.AT_RISK, 'Exactly 30 days should trigger evaluation');
  });

  test('[LC-14b] 29 days old + low traffic → stays published', () => {
    const post = freePost({ createdAt: daysAgo(THRESHOLDS.MIN_AGE_DAYS - 1, NOW) });
    const result = evaluateLifecycle(post, 0, NOW);
    assert.equal(result.status, STATUS.PUBLISHED, '29 days is below the threshold');
  });
});
