/**
 * lib/internal-auth.js — Auth helpers for /internal dashboard + /api/internal/* routes
 *
 * Flow (when INTERNAL_DASHBOARD_TOKEN is set):
 *   1. `x-internal-token` header  → direct API access (curl / scripts)
 *   2. Session cookie              → browser dashboard sessions
 *   3. POST /internal/auth         → submit token → validate → issue cookie → redirect
 *   4. GET  /internal?token=       → legacy compat → set cookie → redirect to clean URL
 *   5. No valid auth               → 401 login form (HTML) or 401 JSON (API)
 *
 * When INTERNAL_DASHBOARD_TOKEN is unset the dashboard is open (dev-only).
 * A warning banner is shown in the UI.
 *
 * Session cookie:
 *   - HMAC-SHA256 signed, payload contains issued-at timestamp
 *   - TTL: 8 hours (configurable via SESSION_TTL_MS export)
 *   - Name: `_mdp-session` (dev/HTTP) | `__Host-mdp-session` (prod/HTTPS)
 *   - Flags: HttpOnly, SameSite=Strict, Path=/
 *   - Prod adds: Secure
 */

import { timingSafeEqual, createHmac } from 'node:crypto';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// __Host- prefix requires Secure + no Domain attribute + Path=/ — HTTPS only
export const getCookieName = (isProd) =>
  isProd ? '__Host-mdp-session' : '_mdp-session';

// ── Crypto helpers ────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing-based token oracle attacks.
 * Always processes both inputs fully before returning.
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      // Normalise timing: still run a comparison of equal-length buffers
      const dummy = Buffer.alloc(Math.max(bufA.length, 1), 0);
      timingSafeEqual(dummy, dummy);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function hmacB64(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// ── Session cookie lifecycle ──────────────────────────────────────────────────

/**
 * Create a signed session value.
 * Format: `<base64url(json_payload)>.<hmac>`
 */
export function createSession(secret) {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString('base64url');
  const sig = hmacB64(payload, secret);
  return `${payload}.${sig}`;
}

/**
 * Verify a session value.
 * Returns true if signature is valid and session has not expired.
 */
export function verifySession(value, secret) {
  if (!value || typeof value !== 'string') return false;
  try {
    const dot = value.lastIndexOf('.');
    if (dot === -1) return false;
    const payload = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    if (!constantTimeEqual(sig, hmacB64(payload, secret))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.iat !== 'number') return false;
    return Date.now() - data.iat < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

/**
 * Parse Cookie header → plain object.
 */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const chunk of String(header).split(';')) {
    const i = chunk.indexOf('=');
    if (i === -1) continue;
    const k = chunk.slice(0, i).trim();
    const v = chunk.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

/**
 * Build the Set-Cookie header value for a new session.
 */
export function buildSetCookieHeader(name, value, isProd) {
  const ttlSec = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${ttlSec}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build a cookie header that immediately expires an existing session (logout).
 */
export function buildClearCookieHeader(name, isProd) {
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

// ── Middleware factories ───────────────────────────────────────────────────────

/**
 * Middleware for /api/internal/* routes.
 * Accepts: x-internal-token header OR session cookie.
 * Responds with JSON 401 on failure.
 */
export function apiInternalAuth() {
  return (req, res, next) => {
    const expected = process.env.INTERNAL_DASHBOARD_TOKEN;
    if (!expected) return next(); // open in dev

    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = getCookieName(isProd);

    // Header check
    const headerToken = req.get('x-internal-token');
    if (headerToken && constantTimeEqual(headerToken, expected)) return next();

    // Cookie check
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[cookieName] && verifySession(cookies[cookieName], expected)) return next();

    return res.status(401).json({ error: 'Unauthorized. Provide x-internal-token header.' });
  };
}

/**
 * Middleware for GET /internal dashboard.
 * Accepts: session cookie OR ?token= query param (→ redirect after setting cookie).
 * Responds with HTML login form on failure.
 */
export function dashboardAuth() {
  return (req, res, next) => {
    const expected = process.env.INTERNAL_DASHBOARD_TOKEN;
    if (!expected) return next(); // open in dev

    const isProd = process.env.NODE_ENV === 'production';
    const cookieName = getCookieName(isProd);

    // Cookie check (main path for returning users)
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[cookieName] && verifySession(cookies[cookieName], expected)) return next();

    // Legacy: ?token= in query param → set cookie, redirect to strip from URL
    // (Allows bookmarked links and programmatic access while still removing token from URL)
    const queryToken = req.query?.token;
    if (queryToken && constantTimeEqual(String(queryToken), expected)) {
      const session = createSession(expected);
      const cookie = buildSetCookieHeader(cookieName, session, isProd);
      res.setHeader('Set-Cookie', cookie);
      // Preserve any other non-token query params
      const next_qs = new URLSearchParams(req.query);
      next_qs.delete('token');
      const redir = '/internal' + (next_qs.toString() ? '?' + next_qs.toString() : '');
      res.setHeader('Location', redir);
      return res.status(302).end();
    }

    return res.status(401).type('html').send(buildLoginPage());
  };
}

// ── HTML views ────────────────────────────────────────────────────────────────

const SHARED_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
`;

/**
 * Login / 401 HTML page.
 */
export function buildLoginPage(errorMsg = '') {
  const esc = htmlEsc;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>mdpage — internal access</title>
<style>${SHARED_CSS}
body{display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:100%;max-width:380px;text-align:center}
.logo{font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#f8fafc;margin-bottom:2px}
.logo span{color:#6366f1}.subtitle{color:#94a3b8;font-size:13px;margin-bottom:24px}
.err{background:#3f1515;border:1px solid #7f1d1d;color:#fca5a5;padding:10px 12px;border-radius:6px;font-size:13px;margin-bottom:16px;text-align:left}
label{display:block;font-size:12px;font-weight:500;color:#94a3b8;margin-bottom:6px;text-align:left}
input{width:100%;padding:10px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#f1f5f9;font-size:14px;outline:none}
input:focus{border-color:#6366f1}
button{width:100%;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;margin-top:12px}
button:hover{background:#4f46e5}
.hint{color:#64748b;font-size:11px;margin-top:16px}code{font-size:10px;background:#0f172a;padding:1px 4px;border-radius:3px}
</style></head><body>
<div class="card">
  <div class="logo">md<span>page</span></div>
  <div class="subtitle">Internal Dashboard</div>
  ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ''}
  <form method="POST" action="/internal/auth">
    <label for="tok">Access Token</label>
    <input type="password" id="tok" name="token" placeholder="Paste token…" autocomplete="current-password" required autofocus/>
    <button type="submit">Access Dashboard</button>
  </form>
  <div class="hint">Set via <code>INTERNAL_DASHBOARD_TOKEN</code> env var.</div>
</div>
</body></html>`;
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function htmlEsc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]),
  );
}
