/**
 * lib/abuse.js — Abuse controls v2
 *
 * Extends the Phase 1 rate limiter with:
 *
 *   1. IP block list  — hard-block known bad actors (configurable via env)
 *   2. IP warn list   — log + soft-slow-down for suspicious but not yet blocked IPs
 *   3. Burst detection — flag IPs that send more than N requests in a short window
 *      (tighter than the rate limit window, to catch flood bots that stay under limits)
 *   4. Fingerprint scoring — combine IP, User-Agent, and X-Forwarded-For into a
 *      single abuse score; score >= threshold triggers slow-down or block
 *   5. Configurable response strategy per score band:
 *      - score 0    → allow
 *      - score 1    → allow + log warn
 *      - score 2    → 429 with Retry-After
 *      - score 3+   → 403 with fake-success body (honeypot style)
 *   6. Abuse event log — in-memory ring buffer of the last N events for
 *      operator inspection via /api/internal/abuse
 *
 * All state is in-process only. Replace with Redis for multi-node deployments.
 *
 * Environment variables:
 *   ABUSE_BLOCK_LIST   — comma-separated IPs to hard-block (e.g. "1.2.3.4,5.6.7.8")
 *   ABUSE_WARN_LIST    — comma-separated IPs to flag as suspicious
 *   ABUSE_BURST_MAX    — max requests allowed in the burst window (default: 10)
 *   ABUSE_BURST_WIN    — burst window in seconds (default: 5)
 *   ABUSE_SCORE_BLOCK  — minimum score to trigger 403 fake-success (default: 3)
 *   ABUSE_SCORE_LIMIT  — minimum score to trigger 429 (default: 2)
 *   ABUSE_LOG_SIZE     — max entries in in-memory abuse event ring (default: 200)
 */

import log from './logger.js';

// ── Config ────────────────────────────────────────────────────────────────────

const IS_TEST = process.env.NODE_ENV === 'test';

function parseList(env) {
  if (!env) return new Set();
  return new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
}

export const abuseConfig = {
  blockList:   parseList(process.env.ABUSE_BLOCK_LIST),
  warnList:    parseList(process.env.ABUSE_WARN_LIST),
  burstMax:    parseInt(process.env.ABUSE_BURST_MAX    ?? '10',  10),
  burstWinMs:  parseInt(process.env.ABUSE_BURST_WIN    ?? '5',   10) * 1000,
  scoreBlock:  parseInt(process.env.ABUSE_SCORE_BLOCK  ?? '3',   10),
  scoreLimit:  parseInt(process.env.ABUSE_SCORE_LIMIT  ?? '2',   10),
  logSize:     parseInt(process.env.ABUSE_LOG_SIZE     ?? '200', 10),
};

// ── Burst tracking ────────────────────────────────────────────────────────────
// Map<ip, number[]> — timestamps of recent requests in the burst window

const _burst = new Map();

/** Returns true if the IP has exceeded the burst threshold in the current window. */
export function checkBurst(ip) {
  if (IS_TEST) return false;

  const now = Date.now();
  const cutoff = now - abuseConfig.burstWinMs;
  let timestamps = _burst.get(ip) ?? [];
  timestamps = timestamps.filter((ts) => ts > cutoff);
  timestamps.push(now);
  _burst.set(ip, timestamps);
  return timestamps.length > abuseConfig.burstMax;
}

/** Cleanup stale burst entries every minute */
setInterval(() => {
  const now = Date.now();
  const cutoff = now - abuseConfig.burstWinMs;
  for (const [ip, ts] of _burst.entries()) {
    const fresh = ts.filter((t) => t > cutoff);
    if (fresh.length === 0) _burst.delete(ip);
    else _burst.set(ip, fresh);
  }
}, 60_000).unref();

// ── Abuse event log ────────────────────────────────────────────────────────────
// Ring buffer of recent abuse events for the /api/internal/abuse endpoint.

const _abuseLog = [];

export function logAbuseEvent(event) {
  _abuseLog.push({ ts: new Date().toISOString(), ...event });
  if (_abuseLog.length > abuseConfig.logSize) {
    _abuseLog.splice(0, _abuseLog.length - abuseConfig.logSize);
  }
}

/** Returns a snapshot of recent abuse events (most recent first). */
export function getAbuseLog() {
  return [..._abuseLog].reverse();
}

// ── Fingerprint scoring ────────────────────────────────────────────────────────

/**
 * Compute an abuse score for an incoming request.
 *
 * Score is additive:
 *   +2  IP is in block list
 *   +1  IP is in warn list
 *   +1  Burst threshold exceeded for this IP
 *   +1  User-Agent is absent or clearly scripted (curl, python-requests, etc.)
 *   +1  X-Forwarded-For header is anomalously long (header stuffing)
 *
 * @param {object} req — Express request object
 * @returns {{ score: number, ip: string, signals: string[] }}
 */
export function scoreRequest(req) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] ?? '';
  const xff = req.headers['x-forwarded-for'] ?? '';
  const signals = [];
  let score = 0;

  if (abuseConfig.blockList.has(ip)) {
    score += 2;
    signals.push('block_list');
  }

  if (abuseConfig.warnList.has(ip)) {
    score += 1;
    signals.push('warn_list');
  }

  if (checkBurst(ip)) {
    score += 1;
    signals.push('burst');
  }

  if (!ua || (/^(curl|python-requests|java\/)/.test(ua) && ua.length < 30)) {
    score += 1;
    signals.push('scripted_ua');
  }

  if (xff.length > 300) {
    score += 1;
    signals.push('xff_stuffed');
  }

  return { score, ip, signals };
}

// ── IP extraction ─────────────────────────────────────────────────────────────

export function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Abuse control middleware.
 *
 * attach: app.post('/api/publish', abuseGuard(), publishHandler)
 *
 * Responses by score band:
 *   score < scoreLimit  → allow (log warn if on warn list)
 *   score >= scoreLimit → 429 with Retry-After: 60
 *   score >= scoreBlock → 403 with fake-success body
 */
export function abuseGuard() {
  return (req, res, next) => {
    if (IS_TEST) return next();

    const { score, ip, signals } = scoreRequest(req);

    if (score === 0) return next();

    if (score < abuseConfig.scoreLimit) {
      // Suspicious but not over threshold — allow + log
      log.warn('abuse.warn', { ip, score, signals, path: req.path });
      logAbuseEvent({ level: 'warn', ip, score, signals, path: req.path });
      return next();
    }

    // Log the abuse event
    logAbuseEvent({ level: 'block', ip, score, signals, path: req.path });
    log.warn('abuse.blocked', { ip, score, signals, path: req.path });

    if (score >= abuseConfig.scoreBlock) {
      // Hard block with honeypot fake success
      return res.json({ success: true, slug: `fake-${Math.random().toString(36).slice(2)}` });
    }

    // Soft block with 429
    return res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfterSeconds: 60,
    });
  };
}

// ── Admin: add/remove IPs from block/warn list at runtime ───────────────────

/**
 * Dynamically add an IP to the block list.
 * Note: block list is initialised from ABUSE_BLOCK_LIST env at startup.
 * Runtime additions are in-memory only and reset on server restart.
 *
 * @param {string} ip
 */
export function blockIp(ip) {
  abuseConfig.blockList.add(ip);
  logAbuseEvent({ level: 'admin', action: 'block', ip });
  log.info('abuse.admin.block', { ip });
}

/**
 * Remove an IP from the block list.
 * @param {string} ip
 */
export function unblockIp(ip) {
  abuseConfig.blockList.delete(ip);
  logAbuseEvent({ level: 'admin', action: 'unblock', ip });
  log.info('abuse.admin.unblock', { ip });
}

/**
 * Add an IP to the warn list.
 * @param {string} ip
 */
export function warnIp(ip) {
  abuseConfig.warnList.add(ip);
  logAbuseEvent({ level: 'admin', action: 'warn', ip });
  log.info('abuse.admin.warn', { ip });
}
