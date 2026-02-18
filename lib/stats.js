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

  const recentRuns = (lifecycleRuns ?? []).filter((r) => isWithinHours(r?.ts, 24, now));
  const lastLifecycleRunAt = (lifecycleRuns ?? [])
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

  return {
    total: entries.length,
    published: entries.filter((e) => (e.status ?? 'published') === 'published').length,
    at_risk: entries.filter((e) => e.status === 'at_risk').length,
    expired: entries.filter((e) => e.status === 'expired').length,
    free: entries.filter((e) => (e.tier ?? 'free') === 'free').length,
    paid: entries.filter((e) => e.tier === 'paid').length,
    lastLifecycleRunAt,
    transitions24h: {
      at_risk: atRiskEntered24h,
      recovered: recovered24h,
      expired: expired24h,
    },
    expiringSoon,
    topPosts30d,
    ts: isoNow(now),
  };
}
