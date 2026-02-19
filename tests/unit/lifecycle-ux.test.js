/**
 * tests/unit/lifecycle-ux.test.js
 *
 * Unit tests for lib/lifecycle-ux.js
 *
 * Coverage tags:
 *   [LUX-01]  urgencyLevel()
 *   [LUX-02]  computeDaysLeft()
 *   [LUX-03]  daysLeftText()
 *   [LUX-04]  statusLabel()
 *   [LUX-05]  buildLifecycleUx()
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  urgencyLevel,
  computeDaysLeft,
  daysLeftText,
  statusLabel,
  buildLifecycleUx,
} from '../../lib/lifecycle-ux.js';

// ── [LUX-01] urgencyLevel ──────────────────────────────────────────────────

test('[LUX-01a] urgencyLevel: null → low', () => {
  assert.equal(urgencyLevel(null), 'low');
});

test('[LUX-01b] urgencyLevel: undefined → low', () => {
  assert.equal(urgencyLevel(undefined), 'low');
});

test('[LUX-01c] urgencyLevel: 0 → critical', () => {
  assert.equal(urgencyLevel(0), 'critical');
});

test('[LUX-01d] urgencyLevel: -1 → critical (past expiry)', () => {
  assert.equal(urgencyLevel(-1), 'critical');
});

test('[LUX-01e] urgencyLevel: 1 → high', () => {
  assert.equal(urgencyLevel(1), 'high');
});

test('[LUX-01f] urgencyLevel: 2 → high', () => {
  assert.equal(urgencyLevel(2), 'high');
});

test('[LUX-01g] urgencyLevel: 3 → medium', () => {
  assert.equal(urgencyLevel(3), 'medium');
});

test('[LUX-01h] urgencyLevel: 5 → medium', () => {
  assert.equal(urgencyLevel(5), 'medium');
});

test('[LUX-01i] urgencyLevel: 6 → low', () => {
  assert.equal(urgencyLevel(6), 'low');
});

test('[LUX-01j] urgencyLevel: 100 → low', () => {
  assert.equal(urgencyLevel(100), 'low');
});

// ── [LUX-02] computeDaysLeft ───────────────────────────────────────────────

test('[LUX-02a] computeDaysLeft: null → null', () => {
  assert.equal(computeDaysLeft(null), null);
});

test('[LUX-02b] computeDaysLeft: undefined → null', () => {
  assert.equal(computeDaysLeft(undefined), null);
});

test('[LUX-02c] computeDaysLeft: invalid string → null', () => {
  assert.equal(computeDaysLeft('not-a-date'), null);
});

test('[LUX-02d] computeDaysLeft: past date → 0', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-02-28T00:00:00Z';  // yesterday
  assert.equal(computeDaysLeft(expiresAt, now), 0);
});

test('[LUX-02e] computeDaysLeft: exactly now → 0', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const expiresAt = '2026-03-01T12:00:00Z';
  assert.equal(computeDaysLeft(expiresAt, now), 0);
});

test('[LUX-02f] computeDaysLeft: 1 day ahead → 1', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-03-02T00:00:00Z';
  assert.equal(computeDaysLeft(expiresAt, now), 1);
});

test('[LUX-02g] computeDaysLeft: partial day → rounds up', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-03-01T06:00:00Z';  // 6 hours ahead → 1 day (ceiling)
  assert.equal(computeDaysLeft(expiresAt, now), 1);
});

test('[LUX-02h] computeDaysLeft: 7 days ahead → 7', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-03-08T00:00:00Z';
  assert.equal(computeDaysLeft(expiresAt, now), 7);
});

// ── [LUX-03] daysLeftText ─────────────────────────────────────────────────

test('[LUX-03a] daysLeftText: null → "soon"', () => {
  assert.equal(daysLeftText(null), 'soon');
});

test('[LUX-03b] daysLeftText: 0 → "today"', () => {
  assert.equal(daysLeftText(0), 'today');
});

test('[LUX-03c] daysLeftText: -3 → "today" (past, cap at 0)', () => {
  assert.equal(daysLeftText(-3), 'today');
});

test('[LUX-03d] daysLeftText: 1 → "in 1 day"', () => {
  assert.equal(daysLeftText(1), 'in 1 day');
});

test('[LUX-03e] daysLeftText: 5 → "in 5 days"', () => {
  assert.equal(daysLeftText(5), 'in 5 days');
});

test('[LUX-03f] daysLeftText: 30 → "in 30 days"', () => {
  assert.equal(daysLeftText(30), 'in 30 days');
});

// ── [LUX-04] statusLabel ──────────────────────────────────────────────────

test('[LUX-04a] statusLabel: published', () => {
  assert.equal(statusLabel('published'), 'Published');
});

test('[LUX-04b] statusLabel: at_risk', () => {
  assert.equal(statusLabel('at_risk'), 'At Risk');
});

test('[LUX-04c] statusLabel: expired', () => {
  assert.equal(statusLabel('expired'), 'Expired');
});

test('[LUX-04d] statusLabel: unknown string → "Unknown"', () => {
  assert.equal(statusLabel('bogus'), 'Unknown');
});

// ── [LUX-05] buildLifecycleUx ─────────────────────────────────────────────

test('[LUX-05a] buildLifecycleUx: published article has no expiry info', () => {
  const meta = { status: 'published', expiresAt: null };
  const ux = buildLifecycleUx(meta);
  assert.equal(ux.status, 'published');
  assert.equal(ux.statusLabel, 'Published');
  assert.equal(ux.daysLeft, null);
  assert.equal(ux.daysLeftText, 'soon');
  assert.equal(ux.urgency, 'low');
  assert.equal(ux.expiresAt, null);
});

test('[LUX-05b] buildLifecycleUx: at_risk with 3 days left', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-03-04T00:00:00Z';
  const meta = { status: 'at_risk', expiresAt };
  const ux = buildLifecycleUx(meta, now);
  assert.equal(ux.status, 'at_risk');
  assert.equal(ux.statusLabel, 'At Risk');
  assert.equal(ux.daysLeft, 3);
  assert.equal(ux.daysLeftText, 'in 3 days');
  assert.equal(ux.urgency, 'medium');
  assert.equal(ux.expiresAt, expiresAt);
});

test('[LUX-05c] buildLifecycleUx: at_risk with 1 day left (high urgency)', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const expiresAt = '2026-03-02T00:00:00Z';
  const meta = { status: 'at_risk', expiresAt };
  const ux = buildLifecycleUx(meta, now);
  assert.equal(ux.urgency, 'high');
  assert.equal(ux.daysLeft, 1);
  assert.equal(ux.daysLeftText, 'in 1 day');
});

test('[LUX-05d] buildLifecycleUx: at_risk expired countdown (critical)', () => {
  const now = new Date('2026-03-05T00:00:00Z');
  const expiresAt = '2026-03-03T00:00:00Z';
  const meta = { status: 'at_risk', expiresAt };
  const ux = buildLifecycleUx(meta, now);
  assert.equal(ux.daysLeft, 0);
  assert.equal(ux.urgency, 'critical');
  assert.equal(ux.daysLeftText, 'today');
});

test('[LUX-05e] buildLifecycleUx: expired article', () => {
  const meta = { status: 'expired', expiresAt: '2026-02-01T00:00:00Z' };
  const ux = buildLifecycleUx(meta);
  assert.equal(ux.status, 'expired');
  assert.equal(ux.statusLabel, 'Expired');
  assert.equal(ux.daysLeft, null);  // expired posts don't surface daysLeft
  assert.equal(ux.urgency, 'low');
});

test('[LUX-05f] buildLifecycleUx: missing status defaults to published', () => {
  const meta = {};
  const ux = buildLifecycleUx(meta);
  assert.equal(ux.status, 'published');
  assert.equal(ux.statusLabel, 'Published');
});
