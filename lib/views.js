/**
 * lib/views.js — View tracking with daily unique dedupe
 *
 * Storage layout:
 *   data/views/{slug}.json
 *   {
 *     "daily": {
 *       "2026-02-18": ["fp1", "fp2"],   // unique fingerprints that day
 *       "2026-02-17": ["fp3"]
 *     }
 *   }
 *
 * Fingerprint strategy:
 *   SHA-256( IP + Date + UserAgent ) → first 16 hex chars.
 *   Keeps storage small; not reversible to PII.
 *   Date is included so the same visitor visiting on a new day
 *   generates a fresh fingerprint → that day's bucket increments.
 *
 * 30-day unique count:
 *   Sum of each day's unique-fingerprint count within the 30-day window.
 *   (i.e. "unique daily sessions" — same visitor on 3 days = 3 views)
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import log from './logger.js';

const VIEWS_DIR = './data/views';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD string in UTC */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Return an array of YYYY-MM-DD strings for the past `n` days (inclusive today) */
function lastNDays(n = 30) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Derive a short, non-reversible fingerprint from request metadata */
export function fingerprintRequest(ip, userAgent, dateStr) {
  return createHash('sha256')
    .update(`${ip}|${dateStr}|${userAgent}`)
    .digest('hex')
    .slice(0, 16);
}

/** Ensure data/views/ directory exists */
async function ensureViewsDir() {
  await fs.mkdir(VIEWS_DIR, { recursive: true });
}

/** Load a slug's view data file, or return a fresh structure */
async function loadViewData(slug) {
  const filePath = path.join(VIEWS_DIR, `${slug}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { daily: {} };
  }
}

/** Persist a slug's view data file */
async function saveViewData(slug, data) {
  await ensureViewsDir();
  const filePath = path.join(VIEWS_DIR, `${slug}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Per-slug mutex for concurrent view requests ───────────────────────────────
const _viewLocks = new Map(); // slug → Promise chain

async function withViewLock(slug, fn) {
  const prev = _viewLocks.get(slug) ?? Promise.resolve();
  let release;
  const current = new Promise((r) => { release = r; });
  _viewLocks.set(slug, current);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Clean up map entry only if no new lock has been queued in the meantime
    if (_viewLocks.get(slug) === current) {
      _viewLocks.delete(slug);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a view for a slug, deduplicating within the same day.
 *
 * @param {string} slug
 * @param {string} identity     - stable visitor identity string.
 *   Pass the raw X-Visitor-Id when available, or a pre-joined "ip|ua" string.
 *   The value is hashed with the current date before storage — never stored raw.
 * @param {string} [extra='']   - optional additional discriminator (legacy UA slot)
 * @returns {Promise<{ recorded: boolean, fingerprint: string, date: string }>}
 *   recorded=true  → new unique view recorded
 *   recorded=false → already seen today, no-op
 */
export async function recordView(slug, identity, extra = '') {
  const date = today();
  const fp = fingerprintRequest(identity, extra, date);

  return withViewLock(slug, async () => {
    const data = await loadViewData(slug);

    if (!data.daily[date]) {
      data.daily[date] = [];
    }

    if (data.daily[date].includes(fp)) {
      log.debug('view.duplicate', { slug, date, fp });
      return { recorded: false, fingerprint: fp, date };
    }

    data.daily[date].push(fp);
    await saveViewData(slug, data);

    log.info('view.recorded', { slug, date, fp, dayTotal: data.daily[date].length });
    return { recorded: true, fingerprint: fp, date };
  });
}

/**
 * Compute the total unique daily sessions in the last `windowDays` days.
 *
 * @param {string} slug
 * @param {number} [windowDays=30]
 * @returns {Promise<number>}
 */
export async function getUniqueViewCount(slug, windowDays = 30) {
  const data = await loadViewData(slug);
  const window = new Set(lastNDays(windowDays));
  let count = 0;
  for (const [date, fps] of Object.entries(data.daily)) {
    if (window.has(date)) count += fps.length;
  }
  return count;
}

/**
 * Prune view data older than `keepDays` days to prevent unbounded growth.
 * Safe to call periodically (e.g. alongside lifecycle evaluator).
 *
 * @param {string} slug
 * @param {number} [keepDays=35]
 */
export async function pruneViewData(slug, keepDays = 35) {
  return withViewLock(slug, async () => {
    const data = await loadViewData(slug);
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    let pruned = 0;
    for (const date of Object.keys(data.daily)) {
      if (date < cutoffStr) {
        delete data.daily[date];
        pruned++;
      }
    }

    if (pruned > 0) {
      await saveViewData(slug, data);
      log.debug('views.pruned', { slug, pruned, keepDays });
    }

    return pruned;
  });
}

/**
 * Return the raw daily view data for debugging/admin.
 * @param {string} slug
 * @returns {Promise<object>}
 */
export async function getViewData(slug) {
  return loadViewData(slug);
}
