/**
 * lib/lifecycle.js — Content lifecycle evaluator for free posts
 *
 * States:
 *   published  → default for newly created posts
 *   at_risk    → below traffic threshold for too long; countdown started
 *   expired    → countdown elapsed without recovery; removed from public view
 *   (paid posts are always "published" and never evaluated here)
 *
 * Default thresholds (overridable via env vars for easy tuning):
 *   MIN_AGE_DAYS          = 30   — post must be older than this before evaluation
 *   UNIQUE_VIEW_THRESHOLD = 10   — min unique views in last 30 days to stay healthy
 *   AT_RISK_WINDOW_DAYS   = 7    — warning countdown before expiry
 *
 * Lifecycle transitions:
 *   published → at_risk    : age > MIN_AGE_DAYS AND views < threshold
 *   at_risk   → published  : (recovery) views >= threshold during countdown
 *   at_risk   → expired    : now >= expiresAt AND views still < threshold
 *
 * All transitions are logged with structured events.
 */

import log from './logger.js';
import { getUniqueViewCount, pruneViewData } from './views.js';

// ── Config ────────────────────────────────────────────────────────────────────
const MIN_AGE_DAYS          = parseInt(process.env.LC_MIN_AGE_DAYS          ?? '30', 10);
const UNIQUE_VIEW_THRESHOLD = parseInt(process.env.LC_UNIQUE_VIEW_THRESHOLD ?? '10', 10);
const AT_RISK_WINDOW_DAYS   = parseInt(process.env.LC_AT_RISK_WINDOW_DAYS   ?? '7',  10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

function addDays(isoString, days) {
  const d = new Date(isoString);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Returns true if the post is old enough to be evaluated for lifecycle */
function isEvaluatable(meta) {
  return meta.tier === 'free' && daysAgo(meta.createdAt) > MIN_AGE_DAYS;
}

// ── Core evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate a single article's lifecycle status and return the updated metadata.
 * Does NOT persist — caller is responsible for saving.
 *
 * @param {object} meta - article metadata from index
 * @returns {Promise<{ meta: object, transition: string|null }>}
 *   transition: null | 'at_risk' | 'recovered' | 'expired' | 'no_change'
 */
export async function evaluateArticle(meta) {
  // Paid posts never expire
  if (meta.tier === 'paid') {
    return { meta, transition: null };
  }

  // Too new to evaluate
  if (!isEvaluatable(meta)) {
    return { meta, transition: null };
  }

  const views = await getUniqueViewCount(meta.slug, 30);
  const now = new Date().toISOString();
  const currentStatus = meta.status ?? 'published';

  // ── Expired already → nothing to do ─────────────────────────────────────
  if (currentStatus === 'expired') {
    return { meta, transition: null };
  }

  // ── At-risk → check for recovery or expiry ───────────────────────────────
  if (currentStatus === 'at_risk') {
    if (views >= UNIQUE_VIEW_THRESHOLD) {
      // Recovery: traffic has returned
      const updated = {
        ...meta,
        status: 'published',
        atRiskStartedAt: null,
        expiresAt: null,
        last30dUniqueViews: views,
        updatedAt: now,
      };
      log.info('lifecycle.recovered', {
        slug: meta.slug,
        views,
        threshold: UNIQUE_VIEW_THRESHOLD,
        wasAtRiskSince: meta.atRiskStartedAt,
      });
      return { meta: updated, transition: 'recovered' };
    }

    // Check if countdown has elapsed
    if (meta.expiresAt && new Date(now) >= new Date(meta.expiresAt)) {
      const updated = {
        ...meta,
        status: 'expired',
        last30dUniqueViews: views,
        updatedAt: now,
      };
      log.info('lifecycle.expired', {
        slug: meta.slug,
        views,
        threshold: UNIQUE_VIEW_THRESHOLD,
        atRiskSince: meta.atRiskStartedAt,
        expiresAt: meta.expiresAt,
      });
      return { meta: updated, transition: 'expired' };
    }

    // Still at risk, countdown running → refresh views cache
    return {
      meta: { ...meta, last30dUniqueViews: views },
      transition: 'no_change',
    };
  }

  // ── Published → check if new at_risk ────────────────────────────────────
  if (views < UNIQUE_VIEW_THRESHOLD) {
    const expiresAt = addDays(now, AT_RISK_WINDOW_DAYS);
    const updated = {
      ...meta,
      status: 'at_risk',
      atRiskStartedAt: now,
      expiresAt,
      last30dUniqueViews: views,
      updatedAt: now,
    };
    log.info('lifecycle.at_risk', {
      slug: meta.slug,
      views,
      threshold: UNIQUE_VIEW_THRESHOLD,
      expiresAt,
    });
    return { meta: updated, transition: 'at_risk' };
  }

  // Healthy — just refresh views cache
  return {
    meta: { ...meta, last30dUniqueViews: views },
    transition: 'no_change',
  };
}

/**
 * Run the lifecycle evaluator over all articles in the index.
 * Loads and saves the index atomically via the caller-supplied lock helper.
 *
 * @param {Function} loadIndex  - async () => index object
 * @param {Function} saveIndex  - async (index) => void
 * @param {Function} withLock   - async (fn) => result  (index mutex)
 * @returns {Promise<object>}   summary { evaluated, transitions }
 */
export async function runLifecycleSweep(loadIndex, saveIndex, withLock) {
  const summary = {
    evaluated: 0,
    transitions: { at_risk: 0, recovered: 0, expired: 0, no_change: 0, skipped: 0 },
    errors: [],
  };

  log.info('lifecycle.sweep.start', { ts: new Date().toISOString() });

  // Read current index outside the lock (read-only snapshot)
  const index = await loadIndex();
  const slugs = Object.keys(index);

  for (const slug of slugs) {
    const meta = index[slug];
    try {
      const { meta: updated, transition } = await evaluateArticle(meta);

      // Prune stale view data alongside lifecycle evaluation
      await pruneViewData(slug).catch(() => {});

      if (transition === null) {
        summary.transitions.skipped++;
        continue;
      }

      summary.evaluated++;

      if (transition !== 'no_change') {
        // Persist the updated metadata under the index lock
        await withLock(async () => {
          const fresh = await loadIndex();
          fresh[slug] = updated;
          await saveIndex(fresh);
        });
        summary.transitions[transition]++;
      } else {
        // Just refresh views cache (low priority — lock still needed)
        await withLock(async () => {
          const fresh = await loadIndex();
          fresh[slug] = { ...fresh[slug], last30dUniqueViews: updated.last30dUniqueViews };
          await saveIndex(fresh);
        });
      }
    } catch (err) {
      log.error('lifecycle.sweep.error', { slug, error: err.message });
      summary.errors.push({ slug, error: err.message });
    }
  }

  log.info('lifecycle.sweep.done', {
    ...summary,
    slugCount: slugs.length,
  });

  return summary;
}

// ── Configuration export for transparency ─────────────────────────────────────
export const config = {
  MIN_AGE_DAYS,
  UNIQUE_VIEW_THRESHOLD,
  AT_RISK_WINDOW_DAYS,
};
