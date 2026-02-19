/**
 * tests/unit/billing.test.js
 *
 * Unit tests for lib/billing.js
 *
 * Coverage tags:
 *   [BL-01]  billingConfig structure
 *   [BL-02]  defaultBillingMeta()
 *   [BL-03]  applyEntitlement()
 *   [BL-04]  revokeEntitlement()
 *   [BL-05]  hasActiveEntitlement()
 *   [BL-06]  billingReadiness()
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  billingConfig,
  PLANS,
  BILLING_STATUS,
  defaultBillingMeta,
  applyEntitlement,
  revokeEntitlement,
  hasActiveEntitlement,
  billingReadiness,
} from '../../lib/billing.js';

// ── [BL-01] billingConfig structure ──────────────────────────────────────────

describe('[BL-01] billingConfig structure', () => {
  test('billingConfig has provider field', () => {
    assert.ok('provider' in billingConfig, 'provider missing');
  });

  test('billingConfig.provider defaults to "none" without env', () => {
    // In test env BILLING_PROVIDER is not set, so it should be 'none'
    assert.equal(billingConfig.provider, process.env.BILLING_PROVIDER?.toLowerCase() ?? 'none');
  });

  test('billingConfig.stripe has required keys', () => {
    const required = ['secretKey', 'publishableKey', 'webhookSecret', 'paidPriceId'];
    required.forEach((k) => assert.ok(k in billingConfig.stripe, `stripe.${k} missing`));
  });

  test('billingConfig.amountCents is a positive integer', () => {
    assert.ok(typeof billingConfig.amountCents === 'number');
    assert.ok(billingConfig.amountCents > 0);
  });

  test('billingConfig.currency is a non-empty string', () => {
    assert.ok(typeof billingConfig.currency === 'string');
    assert.ok(billingConfig.currency.length > 0);
  });
});

// ── [BL-02] defaultBillingMeta() ─────────────────────────────────────────────

describe('[BL-02] defaultBillingMeta()', () => {
  test('free tier → billingStatus = none', () => {
    const m = defaultBillingMeta('free');
    assert.equal(m.billingStatus, BILLING_STATUS.NONE);
    assert.equal(m.planActivatedAt, null);
    assert.equal(m.checkoutSessionId, null);
  });

  test('paid tier → billingStatus = active', () => {
    const m = defaultBillingMeta('paid');
    assert.equal(m.billingStatus, BILLING_STATUS.ACTIVE);
    assert.ok(m.planActivatedAt !== null, 'planActivatedAt should be set');
  });

  test('paid tier → planActivatedAt is valid ISO string', () => {
    const m = defaultBillingMeta('paid');
    assert.ok(!isNaN(new Date(m.planActivatedAt).getTime()));
  });

  test('free tier → billingProvider is null', () => {
    const m = defaultBillingMeta('free');
    assert.equal(m.billingProvider, null);
  });

  test('paid tier → subscriptionId is null initially', () => {
    const m = defaultBillingMeta('paid');
    assert.equal(m.subscriptionId, null);
  });
});

// ── [BL-03] applyEntitlement() ────────────────────────────────────────────────

describe('[BL-03] applyEntitlement()', () => {
  const baseMeta = {
    slug: 'test-slug',
    tier: 'free',
    adEnabled: true,
    billingStatus: BILLING_STATUS.PENDING,
    checkoutSessionId: 'cs_old',
    subscriptionId: null,
    customerId: null,
  };

  const entitlement = {
    checkoutSessionId: 'cs_new_123',
    subscriptionId:    'sub_abc',
    customerId:        'cus_xyz',
    provider:          'stripe',
  };

  test('upgrades tier to paid', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.tier, 'paid');
  });

  test('sets adEnabled = false', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.adEnabled, false);
  });

  test('sets billingStatus = active', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.billingStatus, BILLING_STATUS.ACTIVE);
  });

  test('persists checkoutSessionId', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.checkoutSessionId, 'cs_new_123');
  });

  test('persists subscriptionId', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.subscriptionId, 'sub_abc');
  });

  test('persists customerId', () => {
    const m = applyEntitlement(baseMeta, entitlement);
    assert.equal(m.customerId, 'cus_xyz');
  });

  test('sets planActivatedAt when not previously set', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const m = applyEntitlement({ ...baseMeta, planActivatedAt: null }, entitlement, now);
    assert.equal(m.planActivatedAt, now.toISOString());
  });

  test('preserves existing planActivatedAt', () => {
    const existing = '2026-01-01T00:00:00.000Z';
    const m = applyEntitlement({ ...baseMeta, planActivatedAt: existing }, entitlement);
    assert.equal(m.planActivatedAt, existing);
  });

  test('does not mutate original meta', () => {
    applyEntitlement(baseMeta, entitlement);
    assert.equal(baseMeta.tier, 'free');   // original unchanged
  });
});

// ── [BL-04] revokeEntitlement() ───────────────────────────────────────────────

describe('[BL-04] revokeEntitlement()', () => {
  const paidMeta = {
    slug: 'paid-slug',
    tier: 'paid',
    adEnabled: false,
    billingStatus: BILLING_STATUS.ACTIVE,
    subscriptionId: 'sub_abc',
  };

  test('reverts tier to free', () => {
    const m = revokeEntitlement(paidMeta);
    assert.equal(m.tier, 'free');
  });

  test('re-enables ads', () => {
    const m = revokeEntitlement(paidMeta);
    assert.equal(m.adEnabled, true);
  });

  test('default reason is refunded', () => {
    const m = revokeEntitlement(paidMeta);
    assert.equal(m.billingStatus, BILLING_STATUS.REFUNDED);
  });

  test('accepts expired reason', () => {
    const m = revokeEntitlement(paidMeta, BILLING_STATUS.EXPIRED);
    assert.equal(m.billingStatus, BILLING_STATUS.EXPIRED);
  });

  test('invalid reason falls back to refunded', () => {
    const m = revokeEntitlement(paidMeta, 'bogus');
    assert.equal(m.billingStatus, BILLING_STATUS.REFUNDED);
  });

  test('sets planExpiresAt to now', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const m = revokeEntitlement(paidMeta, BILLING_STATUS.REFUNDED, now);
    assert.equal(m.planExpiresAt, now.toISOString());
  });

  test('does not mutate original meta', () => {
    revokeEntitlement(paidMeta);
    assert.equal(paidMeta.tier, 'paid');
  });
});

// ── [BL-05] hasActiveEntitlement() ────────────────────────────────────────────

describe('[BL-05] hasActiveEntitlement()', () => {
  test('free tier → false', () => {
    assert.equal(hasActiveEntitlement({ tier: 'free' }), false);
  });

  test('paid + billingStatus active → true', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid', billingStatus: BILLING_STATUS.ACTIVE }), true);
  });

  test('paid + billingStatus cancelled → true (still in period)', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid', billingStatus: BILLING_STATUS.CANCELLED }), true);
  });

  test('paid + billingStatus expired → false', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid', billingStatus: BILLING_STATUS.EXPIRED }), false);
  });

  test('paid + billingStatus refunded → false', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid', billingStatus: BILLING_STATUS.REFUNDED }), false);
  });

  test('paid + no billingStatus (legacy) → true', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid' }), true);
  });

  test('paid + billingStatus none (legacy) → true', () => {
    assert.equal(hasActiveEntitlement({ tier: 'paid', billingStatus: BILLING_STATUS.NONE }), true);
  });
});

// ── [BL-06] billingReadiness() ────────────────────────────────────────────────

describe('[BL-06] billingReadiness()', () => {
  test('provider=none → not ready, single informational issue', () => {
    // In test env BILLING_PROVIDER is not set, so provider is 'none'
    if (process.env.BILLING_PROVIDER === 'stripe') {
      // Skip if somehow configured in test env
      return;
    }
    const r = billingReadiness();
    assert.equal(r.provider, 'none');
    assert.equal(r.ready, false);
    assert.ok(Array.isArray(r.issues));
    assert.ok(r.issues.length > 0);
  });

  test('result always has ready, provider, issues', () => {
    const r = billingReadiness();
    assert.ok('ready' in r);
    assert.ok('provider' in r);
    assert.ok('issues' in r);
    assert.ok(Array.isArray(r.issues));
  });
});
