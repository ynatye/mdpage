/**
 * lib/ratelimit.js — In-memory rate limiting middleware
 *
 * Strategy: sliding window counter per IP + endpoint.
 * State is in-process only — resets on server restart.
 * Fine for single-instance MVP; replace with Redis-backed solution for multi-node.
 *
 * Limits (tunable via env vars):
 *   RATE_PUBLISH_MAX  (default 5)   — publish requests per window
 *   RATE_PUBLISH_WIN  (default 3600 seconds = 1 hour)
 *   RATE_VIEW_MAX     (default 60)  — view requests per window per IP
 *   RATE_VIEW_WIN     (default 60 seconds = 1 minute)
 *
 * Honeypot:
 *   Free publish requests that include a non-empty `_hp` field are silently
 *   rejected (bot bait). Legitimate UIs leave this field empty or absent.
 *
 * Anti-abuse signals:
 *   - Rapid burst from same IP
 *   - High-volume view pumping from single IP
 */

import log from './logger.js';

// ── Config ────────────────────────────────────────────────────────────────────
const RATE_PUBLISH_MAX = parseInt(process.env.RATE_PUBLISH_MAX ?? '5',    10);
const RATE_PUBLISH_WIN = parseInt(process.env.RATE_PUBLISH_WIN ?? '3600', 10) * 1000;
const RATE_VIEW_MAX    = parseInt(process.env.RATE_VIEW_MAX    ?? '60',   10);
const RATE_VIEW_WIN    = parseInt(process.env.RATE_VIEW_WIN    ?? '60',   10) * 1000;

// ── Sliding window store ──────────────────────────────────────────────────────
// Map<key, number[]>  where key = `${endpoint}:${ip}` and values = timestamps

const _store = new Map();

/** Prune timestamps outside the window and check/enforce the limit */
function checkLimit(key, windowMs, maxRequests) {
  const now = Date.now();
  const cutoff = now - windowMs;

  let timestamps = _store.get(key) ?? [];
  // Remove expired timestamps
  timestamps = timestamps.filter((ts) => ts > cutoff);

  if (timestamps.length >= maxRequests) {
    _store.set(key, timestamps);
    return false; // rate-limited
  }

  timestamps.push(now);
  _store.set(key, timestamps);
  return true; // allowed
}

/** Extract the real client IP, respecting common proxy headers */
function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── Cleanup stale keys periodically (every 10 minutes) ───────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of _store.entries()) {
    // Determine window from key prefix
    const windowMs = key.startsWith('view:') ? RATE_VIEW_WIN : RATE_PUBLISH_WIN;
    const fresh = timestamps.filter((ts) => ts > now - windowMs);
    if (fresh.length === 0) {
      _store.delete(key);
    } else {
      _store.set(key, fresh);
    }
  }
}, 10 * 60 * 1000).unref(); // .unref() so the timer doesn't block process exit

// ── Middleware factories ──────────────────────────────────────────────────────

/**
 * Rate-limit middleware for the publish endpoint.
 * Attach: app.post('/api/publish', publishRateLimit(), handler)
 */
export function publishRateLimit() {
  return (req, res, next) => {
    const ip = clientIp(req);
    const key = `publish:${ip}`;

    if (!checkLimit(key, RATE_PUBLISH_WIN, RATE_PUBLISH_MAX)) {
      log.warn('rate_limit.publish', { ip, limit: RATE_PUBLISH_MAX, windowMs: RATE_PUBLISH_WIN });
      return res.status(429).json({
        error: 'Too many publish requests. Please wait before trying again.',
        retryAfterSeconds: Math.ceil(RATE_PUBLISH_WIN / 1000),
      });
    }

    next();
  };
}

/**
 * Rate-limit middleware for the view tracking endpoint.
 */
export function viewRateLimit() {
  return (req, res, next) => {
    const ip = clientIp(req);
    const key = `view:${ip}`;

    if (!checkLimit(key, RATE_VIEW_WIN, RATE_VIEW_MAX)) {
      log.warn('rate_limit.view', { ip, limit: RATE_VIEW_MAX, windowMs: RATE_VIEW_WIN });
      return res.status(429).json({
        error: 'Too many view requests.',
        retryAfterSeconds: Math.ceil(RATE_VIEW_WIN / 1000),
      });
    }

    next();
  };
}

/**
 * Honeypot middleware for free guest publish.
 * Expects a hidden field `_hp` in the request body to be absent or empty.
 * Bots that fill all fields will get silently rejected (200 OK fake response).
 */
export function honeypot() {
  return (req, res, next) => {
    const hp = req.body?._hp;
    if (hp && hp.toString().trim().length > 0) {
      const ip = clientIp(req);
      log.warn('honeypot.triggered', { ip });
      // Return a convincing fake success to confuse bots
      return res.json({ success: true, slug: 'fake-slug-' + Math.random().toString(36).slice(2) });
    }
    next();
  };
}

// ── Export config for transparency (e.g. health endpoint) ─────────────────────
export const rateLimitConfig = {
  publish: { max: RATE_PUBLISH_MAX, windowMs: RATE_PUBLISH_WIN },
  view:    { max: RATE_VIEW_MAX,    windowMs: RATE_VIEW_WIN },
};
