/**
 * tests/unit/internal-auth.test.js
 *
 * Unit tests for lib/internal-auth.js
 *
 * Coverage:
 *   [IA-01] constantTimeEqual — correct/incorrect inputs
 *   [IA-02] createSession / verifySession — happy path round-trip
 *   [IA-03] verifySession — expired session rejected
 *   [IA-04] verifySession — tampered signature rejected
 *   [IA-05] verifySession — malformed / null inputs
 *   [IA-06] parseCookies — header parsing
 *   [IA-07] buildSetCookieHeader — flags, TTL, production vs dev
 *   [IA-08] buildClearCookieHeader — Max-Age=0 logout
 *   [IA-09] getCookieName — environment-based naming
 *   [IA-10] buildLoginPage — HTML structure and XSS escaping
 *
 * Run: node --test tests/unit/internal-auth.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  constantTimeEqual,
  createSession,
  verifySession,
  parseCookies,
  buildSetCookieHeader,
  buildClearCookieHeader,
  getCookieName,
  buildLoginPage,
  SESSION_TTL_MS,
} from '../../lib/internal-auth.js';

// ── [IA-01] constantTimeEqual ─────────────────────────────────────────────────

describe('[IA-01] constantTimeEqual', () => {
  test('identical strings are equal', () => {
    assert.ok(constantTimeEqual('secret123', 'secret123'));
  });

  test('different content returns false', () => {
    assert.ok(!constantTimeEqual('secret123', 'wrong'));
  });

  test('different lengths return false', () => {
    assert.ok(!constantTimeEqual('abc', 'abcd'));
  });

  test('empty strings are equal', () => {
    assert.ok(constantTimeEqual('', ''));
  });

  test('empty vs non-empty returns false', () => {
    assert.ok(!constantTimeEqual('', 'x'));
  });

  test('non-string arguments return false', () => {
    assert.ok(!constantTimeEqual(null, 'x'));
    assert.ok(!constantTimeEqual('x', undefined));
    assert.ok(!constantTimeEqual(123, 123));
  });
});

// ── [IA-02] createSession / verifySession — happy path ───────────────────────

describe('[IA-02] createSession + verifySession round-trip', () => {
  test('creates a dotted string', () => {
    const session = createSession('my-secret');
    assert.ok(typeof session === 'string');
    assert.ok(session.includes('.'));
  });

  test('verifies correctly with the same secret', () => {
    const secret = 'test-secret-abc';
    const session = createSession(secret);
    assert.ok(verifySession(session, secret));
  });

  test('fails with a different secret', () => {
    const session = createSession('secret-a');
    assert.ok(!verifySession(session, 'secret-b'));
  });
});

// ── [IA-03] verifySession — expired ──────────────────────────────────────────

describe('[IA-03] verifySession rejects expired sessions', () => {
  test('session issued before TTL window is rejected', () => {
    const secret = 'test-secret';
    const pastIat = Date.now() - SESSION_TTL_MS - 1000;
    const payload = Buffer.from(JSON.stringify({ iat: pastIat })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    const expired = `${payload}.${sig}`;
    assert.ok(!verifySession(expired, secret));
  });

  test('session issued just within TTL window is accepted', () => {
    const secret = 'test-secret';
    const recentIat = Date.now() - SESSION_TTL_MS + 5000; // 5s before expiry
    const payload = Buffer.from(JSON.stringify({ iat: recentIat })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    const recent = `${payload}.${sig}`;
    assert.ok(verifySession(recent, secret));
  });
});

// ── [IA-04] verifySession — tampered ─────────────────────────────────────────

describe('[IA-04] verifySession rejects tampered signatures', () => {
  test('flipped last char of signature is rejected', () => {
    const secret = 'test-secret';
    const session = createSession(secret);
    const tampered = session.slice(0, -1) + (session.at(-1) === 'A' ? 'B' : 'A');
    assert.ok(!verifySession(tampered, secret));
  });

  test('wrong secret is rejected', () => {
    const session = createSession('correct-secret');
    assert.ok(!verifySession(session, 'wrong-secret'));
  });

  test('payload-only (no sig) is rejected', () => {
    const session = createSession('secret');
    const payloadOnly = session.split('.').slice(0, -1).join('.');
    assert.ok(!verifySession(payloadOnly, 'secret'));
  });
});

// ── [IA-05] verifySession — malformed inputs ──────────────────────────────────

describe('[IA-05] verifySession handles malformed inputs', () => {
  const secret = 'test-secret';

  test('empty string', () => {
    assert.ok(!verifySession('', secret));
  });

  test('no dot separator', () => {
    assert.ok(!verifySession('nodot', secret));
  });

  test('null', () => {
    assert.ok(!verifySession(null, secret));
  });

  test('undefined', () => {
    assert.ok(!verifySession(undefined, secret));
  });

  test('invalid base64url payload', () => {
    assert.ok(!verifySession('not!!!base64.sig', secret));
  });
});

// ── [IA-06] parseCookies ──────────────────────────────────────────────────────

describe('[IA-06] parseCookies', () => {
  test('parses a single cookie', () => {
    const c = parseCookies('name=value');
    assert.equal(c.name, 'value');
  });

  test('parses multiple cookies separated by "; "', () => {
    const c = parseCookies('a=1; b=two; c=three');
    assert.equal(c.a, '1');
    assert.equal(c.b, 'two');
    assert.equal(c.c, 'three');
  });

  test('decodes URI-encoded values', () => {
    const c = parseCookies('tok=hello%20world');
    assert.equal(c.tok, 'hello world');
  });

  test('empty string returns empty object', () => {
    assert.deepEqual(parseCookies(''), {});
  });

  test('null returns empty object', () => {
    assert.deepEqual(parseCookies(null), {});
  });

  test('undefined returns empty object', () => {
    assert.deepEqual(parseCookies(undefined), {});
  });

  test('entries without = are ignored', () => {
    const c = parseCookies('bad; good=ok');
    assert.ok(!('bad' in c));
    assert.equal(c.good, 'ok');
  });

  test('values containing = are preserved correctly', () => {
    // Signed sessions have base64url payloads and dots/= in them
    const c = parseCookies('tok=abc=def=ghi');
    assert.equal(c.tok, 'abc=def=ghi');
  });
});

// ── [IA-07] buildSetCookieHeader ─────────────────────────────────────────────

describe('[IA-07] buildSetCookieHeader', () => {
  test('includes HttpOnly flag', () => {
    const h = buildSetCookieHeader('_mdp-session', 'val', false);
    assert.ok(h.includes('HttpOnly'));
  });

  test('includes SameSite=Strict', () => {
    const h = buildSetCookieHeader('_mdp-session', 'val', false);
    assert.ok(h.includes('SameSite=Strict'));
  });

  test('includes Path=/', () => {
    const h = buildSetCookieHeader('_mdp-session', 'val', false);
    assert.ok(h.includes('Path=/'));
  });

  test('Max-Age matches SESSION_TTL_MS in seconds', () => {
    const h = buildSetCookieHeader('_mdp-session', 'val', false);
    const expectedMaxAge = Math.floor(SESSION_TTL_MS / 1000);
    assert.ok(h.includes(`Max-Age=${expectedMaxAge}`));
  });

  test('Secure flag added in production', () => {
    const h = buildSetCookieHeader('__Host-mdp-session', 'val', true);
    assert.ok(h.includes('Secure'));
  });

  test('Secure flag absent in development', () => {
    const h = buildSetCookieHeader('_mdp-session', 'val', false);
    assert.ok(!h.includes('Secure'));
  });

  test('cookie value is URI-encoded', () => {
    const h = buildSetCookieHeader('_mdp-session', 'hello world', false);
    assert.ok(h.startsWith('_mdp-session=hello%20world'));
  });
});

// ── [IA-08] buildClearCookieHeader ───────────────────────────────────────────

describe('[IA-08] buildClearCookieHeader', () => {
  test('sets Max-Age=0 to expire the cookie', () => {
    const h = buildClearCookieHeader('_mdp-session', false);
    assert.ok(h.includes('Max-Age=0'));
  });

  test('keeps HttpOnly flag on logout cookie', () => {
    const h = buildClearCookieHeader('_mdp-session', false);
    assert.ok(h.includes('HttpOnly'));
  });

  test('keeps SameSite=Strict on logout cookie', () => {
    const h = buildClearCookieHeader('_mdp-session', false);
    assert.ok(h.includes('SameSite=Strict'));
  });
});

// ── [IA-09] getCookieName ─────────────────────────────────────────────────────

describe('[IA-09] getCookieName', () => {
  test('development uses plain _mdp-session name', () => {
    assert.equal(getCookieName(false), '_mdp-session');
  });

  test('production uses __Host-mdp-session prefix', () => {
    assert.equal(getCookieName(true), '__Host-mdp-session');
  });
});

// ── [IA-10] buildLoginPage ────────────────────────────────────────────────────

describe('[IA-10] buildLoginPage', () => {
  test('returns a non-empty HTML string', () => {
    const html = buildLoginPage();
    assert.ok(typeof html === 'string' && html.length > 0);
    assert.ok(html.startsWith('<!doctype html>'));
  });

  test('form POSTs to /internal/auth', () => {
    const html = buildLoginPage();
    assert.ok(html.includes('action="/internal/auth"'));
    assert.ok(html.includes('method="POST"'));
  });

  test('includes a password input', () => {
    const html = buildLoginPage();
    assert.ok(html.includes('type="password"'));
  });

  test('XSS: error message is HTML-escaped', () => {
    const html = buildLoginPage('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'), 'raw <script> not in output');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  });

  test('no error div when no message provided', () => {
    const html = buildLoginPage();
    assert.ok(!html.includes('class="err"'));
  });

  test('error div present when message provided', () => {
    const html = buildLoginPage('Bad token');
    assert.ok(html.includes('class="err"'));
    assert.ok(html.includes('Bad token'));
  });
});
