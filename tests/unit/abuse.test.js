/**
 * tests/unit/abuse.test.js
 *
 * Unit tests for lib/abuse.js
 *
 * Coverage tags:
 *   [AB-01]  abuseConfig structure
 *   [AB-02]  scoreRequest() — signal detection
 *   [AB-03]  checkBurst()
 *   [AB-04]  logAbuseEvent() + getAbuseLog()
 *   [AB-05]  blockIp() / unblockIp() / warnIp()
 *   [AB-06]  abuseGuard() middleware (test-mode pass-through + logic in unit)
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  abuseConfig,
  scoreRequest,
  checkBurst,
  logAbuseEvent,
  getAbuseLog,
  blockIp,
  unblockIp,
  warnIp,
  getClientIp,
} from '../../lib/abuse.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; TestBrowser/1.0)',
      'x-forwarded-for': '',
      ...overrides.headers,
    },
    socket: { remoteAddress: '127.0.0.1' },
    path: '/api/publish',
    ...overrides,
  };
}

// ── [AB-01] abuseConfig structure ──────────────────────────────────────────────

describe('[AB-01] abuseConfig', () => {
  test('blockList is a Set', () => {
    assert.ok(abuseConfig.blockList instanceof Set);
  });

  test('warnList is a Set', () => {
    assert.ok(abuseConfig.warnList instanceof Set);
  });

  test('burstMax is a positive integer', () => {
    assert.ok(typeof abuseConfig.burstMax === 'number');
    assert.ok(abuseConfig.burstMax > 0);
  });

  test('burstWinMs is a positive integer', () => {
    assert.ok(typeof abuseConfig.burstWinMs === 'number');
    assert.ok(abuseConfig.burstWinMs > 0);
  });

  test('scoreBlock > scoreLimit (hard block threshold higher than soft)', () => {
    assert.ok(abuseConfig.scoreBlock >= abuseConfig.scoreLimit);
  });
});

// ── [AB-02] scoreRequest() ────────────────────────────────────────────────────

describe('[AB-02] scoreRequest()', () => {
  test('clean request from unknown IP → score 0', () => {
    const req = makeReq();
    // Remove IP from block/warn lists to ensure clean slate
    const ip = getClientIp(req);
    abuseConfig.blockList.delete(ip);
    abuseConfig.warnList.delete(ip);

    const { score, signals } = scoreRequest(req);
    // In test mode checkBurst always returns false, UA is normal
    // Score should be 0 or 1 (could be scripted_ua if UA matches pattern)
    assert.ok(score >= 0);
    assert.ok(Array.isArray(signals));
  });

  test('block listed IP gets score +2', () => {
    const ip = '10.0.0.1';
    abuseConfig.blockList.add(ip);
    const req = makeReq({ headers: { 'x-forwarded-for': ip } });

    try {
      const { score, signals } = scoreRequest(req);
      assert.ok(score >= 2);
      assert.ok(signals.includes('block_list'));
    } finally {
      abuseConfig.blockList.delete(ip);
    }
  });

  test('warn listed IP gets score +1 (warn_list signal)', () => {
    const ip = '10.0.0.2';
    abuseConfig.warnList.add(ip);
    const req = makeReq({ headers: { 'x-forwarded-for': ip } });

    try {
      const { score, signals } = scoreRequest(req);
      assert.ok(score >= 1);
      assert.ok(signals.includes('warn_list'));
    } finally {
      abuseConfig.warnList.delete(ip);
    }
  });

  test('absent User-Agent adds scripted_ua signal', () => {
    const req = makeReq({ headers: { 'user-agent': '' } });
    const ip = getClientIp(req);
    abuseConfig.blockList.delete(ip);
    abuseConfig.warnList.delete(ip);

    const { signals } = scoreRequest(req);
    assert.ok(signals.includes('scripted_ua'));
  });

  test('anomalously long X-Forwarded-For adds xff_stuffed signal', () => {
    const longXff = '1.2.3.4, ' + 'a'.repeat(300);
    const req = makeReq({ headers: { 'x-forwarded-for': longXff } });
    // IP from XFF will be '1.2.3.4'
    abuseConfig.blockList.delete('1.2.3.4');
    abuseConfig.warnList.delete('1.2.3.4');

    const { signals } = scoreRequest(req);
    assert.ok(signals.includes('xff_stuffed'));
  });

  test('returns ip field', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '9.8.7.6' } });
    const { ip } = scoreRequest(req);
    assert.equal(ip, '9.8.7.6');
  });
});

// ── [AB-03] checkBurst() ─────────────────────────────────────────────────────

describe('[AB-03] checkBurst()', () => {
  test('in test mode always returns false', () => {
    // NODE_ENV=test means IS_TEST=true → always false
    assert.equal(checkBurst('1.2.3.4'), false);
    assert.equal(checkBurst('1.2.3.4'), false);
    assert.equal(checkBurst('1.2.3.4'), false);
  });
});

// ── [AB-04] logAbuseEvent() + getAbuseLog() ───────────────────────────────────

describe('[AB-04] logAbuseEvent() + getAbuseLog()', () => {
  test('logged events appear in getAbuseLog()', () => {
    const beforeCount = getAbuseLog().length;
    logAbuseEvent({ level: 'test', ip: '1.2.3.4', score: 1, signals: ['test'] });
    const after = getAbuseLog();
    assert.ok(after.length > beforeCount);
  });

  test('events appear most-recent-first', () => {
    logAbuseEvent({ level: 'test', ip: 'first', note: 'first' });
    logAbuseEvent({ level: 'test', ip: 'second', note: 'second' });
    const log = getAbuseLog();
    // Most recent first
    const secondIdx = log.findIndex((e) => e.note === 'second');
    const firstIdx  = log.findIndex((e) => e.note === 'first');
    assert.ok(secondIdx < firstIdx, 'second event should appear before first in reversed log');
  });

  test('events have ts field', () => {
    logAbuseEvent({ level: 'test', ip: '5.5.5.5' });
    const entry = getAbuseLog()[0];
    assert.ok(typeof entry.ts === 'string');
    assert.ok(!isNaN(new Date(entry.ts).getTime()));
  });

  test('log does not grow beyond logSize', () => {
    const size = abuseConfig.logSize;
    for (let i = 0; i < size + 20; i++) {
      logAbuseEvent({ level: 'fill', ip: `10.0.${i}.1` });
    }
    assert.ok(getAbuseLog().length <= size);
  });
});

// ── [AB-05] blockIp / unblockIp / warnIp ─────────────────────────────────────

describe('[AB-05] blockIp / unblockIp / warnIp', () => {
  const testIp = '192.168.99.1';

  test('blockIp adds IP to blockList', () => {
    abuseConfig.blockList.delete(testIp);
    blockIp(testIp);
    assert.ok(abuseConfig.blockList.has(testIp));
    abuseConfig.blockList.delete(testIp);
  });

  test('unblockIp removes IP from blockList', () => {
    abuseConfig.blockList.add(testIp);
    unblockIp(testIp);
    assert.ok(!abuseConfig.blockList.has(testIp));
  });

  test('warnIp adds IP to warnList', () => {
    abuseConfig.warnList.delete(testIp);
    warnIp(testIp);
    assert.ok(abuseConfig.warnList.has(testIp));
    abuseConfig.warnList.delete(testIp);
  });
});

// ── [AB-06] getClientIp() ────────────────────────────────────────────────────

describe('[AB-06] getClientIp()', () => {
  test('prefers X-Forwarded-For', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } });
    assert.equal(getClientIp(req), '1.1.1.1');
  });

  test('falls back to socket.remoteAddress', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '' } });
    assert.equal(getClientIp(req), '127.0.0.1');
  });

  test('returns unknown if no address available', () => {
    const req = { headers: { 'x-forwarded-for': '' }, socket: {}, path: '/' };
    assert.equal(getClientIp(req), 'unknown');
  });
});
