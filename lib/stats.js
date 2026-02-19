/**
 * lib/stats.js — internal operational stats helpers
 */

function isoNow(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function isWithinHours(iso, hours, now = new Date()) {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts >= (new Date(now).getTime() - hours * 60 * 60 * 1000);
}

export function computeInternalStats(index = {}, lifecycleRuns = [], now = new Date()) {
  const entries = Object.values(index ?? {});
  const runs = lifecycleRuns ?? [];

  const recentRuns = runs.filter((r) => isWithinHours(r?.ts, 24, now));
  const lastLifecycleRunAt = runs
    .map((r) => r?.ts)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const atRiskEntered24h = recentRuns.reduce((acc, r) => acc + Number(r?.transitions?.at_risk ?? 0), 0);
  const recovered24h = recentRuns.reduce((acc, r) => acc + Number(r?.transitions?.recovered ?? 0), 0);
  const expired24h = recentRuns.reduce((acc, r) => acc + Number(r?.transitions?.expired ?? 0), 0);

  const topPosts30d = entries
    .map((e) => ({
      slug: e.slug,
      title: e.title,
      tier: e.tier ?? 'free',
      status: e.status ?? 'published',
      last30dUniqueViews: Number(e.last30dUniqueViews ?? 0),
    }))
    .sort((a, b) => b.last30dUniqueViews - a.last30dUniqueViews)
    .slice(0, 10);

  const expiringSoon = entries
    .filter((e) => (e.status ?? 'published') === 'at_risk' && e.expiresAt)
    .map((e) => {
      const ms = new Date(e.expiresAt).getTime() - new Date(now).getTime();
      const daysRemaining = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
      return {
        slug: e.slug,
        title: e.title,
        tier: e.tier ?? 'free',
        expiresAt: e.expiresAt,
        daysRemaining,
      };
    })
    .filter((e) => e.daysRemaining <= 7)
    .sort((a, b) => a.daysRemaining - b.daysRemaining || a.slug.localeCompare(b.slug));

  // ── Richer Day-3 metrics ──────────────────────────────────────────────────

  /** Sum of all-time views across all articles in the index. */
  const totalViews = entries.reduce((acc, e) => acc + Number(e.totalViews ?? 0), 0);

  /** Articles created in the last 7 days. */
  const publishedLast7d = entries.filter((e) => isWithinHours(e.createdAt, 7 * 24, now)).length;

  /**
   * Active free articles (non-expired) with zero unique views in the last 30 days.
   * Useful as an early-warning signal: these are candidates for at_risk transitions.
   */
  const zeroViewsCount = entries.filter(
    (e) =>
      (e.tier ?? 'free') === 'free' &&
      (e.status ?? 'published') !== 'expired' &&
      Number(e.last30dUniqueViews ?? 0) === 0,
  ).length;

  /** Number of lifecycle sweeps that ran in the last 24 hours. */
  const sweepCount24h = recentRuns.length;

  /**
   * Last 10 lifecycle runs in reverse-chronological order.
   * Suitable for a "run history" table in the dashboard.
   */
  const lifecycleRunHistory = [...runs]
    .slice(-10)
    .reverse()
    .map((r) => ({
      ts:        r.ts,
      evaluated: Number(r.evaluated   ?? 0),
      at_risk:   Number(r.transitions?.at_risk   ?? 0),
      recovered: Number(r.transitions?.recovered ?? 0),
      expired:   Number(r.transitions?.expired   ?? 0),
      errors:    Number(r.errors ?? 0),
    }));

  return {
    total: entries.length,
    published: entries.filter((e) => (e.status ?? 'published') === 'published').length,
    at_risk: entries.filter((e) => e.status === 'at_risk').length,
    expired: entries.filter((e) => e.status === 'expired').length,
    free: entries.filter((e) => (e.tier ?? 'free') === 'free').length,
    paid: entries.filter((e) => e.tier === 'paid').length,
    totalViews,
    publishedLast7d,
    zeroViewsCount,
    sweepCount24h,
    lastLifecycleRunAt,
    transitions24h: {
      at_risk: atRiskEntered24h,
      recovered: recovered24h,
      expired: expired24h,
    },
    lifecycleRunHistory,
    expiringSoon,
    topPosts30d,
    ts: isoNow(now),
  };
}
