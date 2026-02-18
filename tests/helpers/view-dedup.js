/**
 * tests/helpers/view-dedup.js
 *
 * Phase 1 view deduplication — reference implementation for QA tests.
 *
 * PRD contract: "Idempotent per visitor/day (cookie or hashed fingerprint + date bucket)"
 *
 * Reference strategy:
 *   visitorKey = hash(ip + userAgent + slug + dateBucket)
 *   dateBucket = YYYY-MM-DD (UTC)
 *   A view is counted only once per (visitorKey, dateBucket)
 *
 * The server may use cookies, IP hashing, or any stable fingerprint.
 * The invariant this tests enforces:
 *   - Same visitor, same day → only 1 unique view
 *   - Same visitor, different day → 2 unique views
 *   - Different visitors, same day → 2 unique views
 *   - 30-day window: views older than 30 days are excluded from last30d count
 */

/**
 * Compute the date bucket key for a given timestamp (UTC YYYY-MM-DD).
 */
export function dateBucket(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Create a visitor key from identifying components.
 * In the server this would be a crypto hash; here we use a simple string join.
 *
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} slug
 * @param {string} bucket    YYYY-MM-DD
 * @returns {string} dedup key
 */
export function makeVisitorKey(ip, userAgent, slug, bucket) {
  // Simple concat; in production this is a hash (sha256 or similar)
  return `${ip}|${userAgent}|${slug}|${bucket}`;
}

/**
 * In-memory view store for testing.
 * Mirrors the data/views/{slug}.json structure the server should maintain.
 */
export class ViewStore {
  constructor() {
    // Map<slug, Set<visitorKey>>
    this._store = new Map();
    // Map<slug, Map<bucket, Set<visitorKey>>> — for 30d window computation
    this._byBucket = new Map();
  }

  /**
   * Record a view. Returns true if it was a NEW unique view, false if deduplicated.
   */
  recordView(slug, visitorKey, bucket) {
    if (!this._store.has(slug)) this._store.set(slug, new Set());
    if (!this._byBucket.has(slug)) this._byBucket.set(slug, new Map());

    const byDay = this._byBucket.get(slug);
    if (!byDay.has(bucket)) byDay.set(bucket, new Set());

    const daySet = byDay.get(bucket);
    if (daySet.has(visitorKey)) {
      return false; // duplicate
    }

    daySet.add(visitorKey);
    this._store.get(slug).add(`${visitorKey}|${bucket}`);
    return true;
  }

  /**
   * Compute unique views in the last N days for a slug.
   *
   * @param {string} slug
   * @param {number} days   Rolling window size (default 30)
   * @param {Date}   now    Injectable current time
   * @returns {number}
   */
  last30dUniqueViews(slug, days = 30, now = new Date()) {
    const byDay = this._byBucket.get(slug);
    if (!byDay) return 0;

    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let count = 0;

    for (const [bucket, visitors] of byDay.entries()) {
      const bucketDate = new Date(bucket + 'T00:00:00Z');
      if (bucketDate >= cutoff) {
        count += visitors.size;
      }
    }
    return count;
  }

  /**
   * Total views recorded for a slug (no window, all time).
   */
  totalViews(slug) {
    return this._store.get(slug)?.size ?? 0;
  }

  reset(slug) {
    this._store.delete(slug);
    this._byBucket.delete(slug);
  }
}
