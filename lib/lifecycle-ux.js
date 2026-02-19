/**
 * lib/lifecycle-ux.js — Lifecycle UX metadata helpers
 *
 * Converts raw lifecycle fields from the index into human-facing values
 * that the API response and frontend components can consume directly.
 *
 * This module is intentionally pure (no I/O) so it can be tested
 * deterministically without mocking file-system state.
 */

// ── Urgency levels ────────────────────────────────────────────────────────────

/**
 * Map number of days remaining to an urgency level.
 *
 *   critical  — 0 days (expires today / already past)
 *   high      — 1–2 days
 *   medium    — 3–5 days
 *   low       — 6+ days (or unknown)
 *
 * @param {number|null} daysLeft
 * @returns {'critical'|'high'|'medium'|'low'}
 */
export function urgencyLevel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'low';
  if (daysLeft <= 0) return 'critical';
  if (daysLeft <= 2) return 'high';
  if (daysLeft <= 5) return 'medium';
  return 'low';
}

// ── Days-left computation ──────────────────────────────────────────────────────

/**
 * Compute the number of whole days remaining until an expiry ISO string.
 * Returns null when expiresAt is absent or unparseable.
 * Returns 0 when already past expiry.
 *
 * @param {string|null|undefined} expiresAt — ISO-8601 string from index
 * @param {Date} [now]                       — injectable for deterministic tests
 * @returns {number|null}
 */
export function computeDaysLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) return null;
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ── Human-readable countdown ───────────────────────────────────────────────────

/**
 * Convert daysLeft to a UI-ready string.
 *
 *   null    → 'soon'
 *   0       → 'today'
 *   1       → 'in 1 day'
 *   N       → 'in N days'
 *
 * @param {number|null} daysLeft
 * @returns {string}
 */
export function daysLeftText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'soon';
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'in 1 day';
  return `in ${daysLeft} days`;
}

// ── Status label ───────────────────────────────────────────────────────────────

/**
 * Convert a raw lifecycle status string into a UI-safe display label.
 *
 * @param {'published'|'at_risk'|'expired'|string} status
 * @returns {string}
 */
export function statusLabel(status) {
  switch (status) {
    case 'published': return 'Published';
    case 'at_risk':   return 'At Risk';
    case 'expired':   return 'Expired';
    default:          return 'Unknown';
  }
}

// ── Build lifecycle UX metadata ────────────────────────────────────────────────

/**
 * Build the `lifecycleUx` object included in GET /api/articles/:slug responses.
 *
 * @param {object} meta — raw metadata record from index.json
 * @param {Date}   [now]
 * @returns {{
 *   status:     string,
 *   statusLabel: string,
 *   daysLeft:   number|null,
 *   daysLeftText: string,
 *   urgency:    'critical'|'high'|'medium'|'low',
 *   expiresAt:  string|null,
 * }}
 */
export function buildLifecycleUx(meta, now = new Date()) {
  const status = meta.status ?? 'published';
  const daysLeft = status === 'at_risk' ? computeDaysLeft(meta.expiresAt, now) : null;

  return {
    status,
    statusLabel:  statusLabel(status),
    daysLeft,
    daysLeftText: daysLeftText(daysLeft),
    urgency:      urgencyLevel(daysLeft),
    expiresAt:    meta.expiresAt ?? null,
  };
}
