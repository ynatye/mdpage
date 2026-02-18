/**
 * tests/helpers/lifecycle-machine.js
 *
 * Phase 1 lifecycle state machine — reference implementation for QA tests.
 *
 * This documents the exact state-transition rules the server-side daily job
 * MUST implement. Tests are written against this reference; when the server
 * implements the job, integration tests will replay these scenarios against it.
 *
 * PRD rules:
 *   - Evaluate free posts only (skip paid)
 *   - Age threshold:  > 30 days old
 *   - View threshold: < 10 unique views in last 30 days → at risk
 *   - Warning window: 7 days (atRiskStartedAt → expiresAt)
 *   - Recovery:       views >= threshold during countdown → back to published
 *   - Expiry:         now >= expiresAt AND still below threshold → expired
 */

export const THRESHOLDS = {
  MIN_AGE_DAYS: 30,    // Post must be older than this before becoming at-risk
  VIEW_THRESHOLD: 10,  // Unique views needed in last 30 days to stay healthy
  WARNING_DAYS: 7,     // Days between atRiskStartedAt and expiresAt
};

export const STATUS = {
  PUBLISHED: 'published',
  AT_RISK: 'at_risk',
  EXPIRED: 'expired',
};

/**
 * Evaluate lifecycle transition for a single post.
 *
 * @param {Object} post - Post metadata (tier, status, createdAt, atRiskStartedAt, expiresAt)
 * @param {number} last30dUniqueViews - Unique views count in last 30 days
 * @param {Date}   now                - Current time (injectable for time-travel tests)
 * @returns {Object} Fields to update: { status, atRiskStartedAt?, expiresAt? }
 */
export function evaluateLifecycle(post, last30dUniqueViews, now = new Date()) {
  // Rule: paid posts are NEVER subject to lifecycle evaluation
  if (post.tier === 'paid') {
    return { status: post.status };
  }

  const ageMs = now.getTime() - new Date(post.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const belowThreshold = last30dUniqueViews < THRESHOLDS.VIEW_THRESHOLD;

  switch (post.status) {

    case STATUS.EXPIRED:
      // Terminal state — no transitions out (recovery requires admin intervention)
      return { status: STATUS.EXPIRED };

    case STATUS.AT_RISK: {
      if (!belowThreshold) {
        // Recovery: traffic has recovered — revert to published, clear risk timestamps
        return {
          status: STATUS.PUBLISHED,
          atRiskStartedAt: null,
          expiresAt: null,
        };
      }
      // Still below threshold — check if countdown has expired
      if (post.expiresAt && now >= new Date(post.expiresAt)) {
        return { status: STATUS.EXPIRED };
      }
      // Still in warning window — no change
      return { status: STATUS.AT_RISK };
    }

    case STATUS.PUBLISHED: {
      if (ageDays >= THRESHOLDS.MIN_AGE_DAYS && belowThreshold) {
        // Transition to at_risk
        const atRiskStartedAt = now.toISOString();
        const expiresAt = new Date(
          now.getTime() + THRESHOLDS.WARNING_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
        return {
          status: STATUS.AT_RISK,
          atRiskStartedAt,
          expiresAt,
        };
      }
      // Healthy — no change
      return { status: STATUS.PUBLISHED };
    }

    default:
      throw new Error(`Unknown post status: "${post.status}"`);
  }
}

/**
 * Run the daily lifecycle batch over multiple posts.
 *
 * @param {Object[]} posts       - Array of post metadata objects
 * @param {Function} getViews    - (slug) => number of last-30d unique views
 * @param {Date}     now         - Injectable current time
 * @returns {Object[]} Array of { slug, before, after } transition records
 */
export function runLifecycleBatch(posts, getViews, now = new Date()) {
  return posts.map((post) => {
    const views = getViews(post.slug);
    const before = post.status;
    const changes = evaluateLifecycle(post, views, now);
    return {
      slug: post.slug,
      tier: post.tier,
      before,
      after: changes.status,
      changed: changes.status !== before,
      fields: changes,
    };
  });
}

/**
 * Compute countdown days remaining for an at-risk post.
 * Returns 0 if already expired, null if not at-risk.
 */
export function countdownDaysRemaining(post, now = new Date()) {
  if (post.status !== STATUS.AT_RISK || !post.expiresAt) return null;
  const msRemaining = new Date(post.expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
}
