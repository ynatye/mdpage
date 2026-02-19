/**
 * tests/unit/webhooks.test.js
 *
 * Unit tests for lib/webhooks.js
 *
 * Coverage tags:
 *   [WH-01]  WebhookVerificationError
 *   [WH-02]  extractSlugFromEvent()
 *   [WH-03]  processStripeEvent() — checkout.session.completed
 *   [WH-04]  processStripeEvent() — payment_intent.payment_failed
 *   [WH-05]  processStripeEvent() — charge.refunded
 *   [WH-06]  processStripeEvent() — customer.subscription.deleted
 *   [WH-07]  processStripeEvent() — customer.subscription.updated
 *   [WH-08]  processStripeEvent() — unknown events
 *   [WH-09]  applyWebhookDispatch() — grant
 *   [WH-10]  applyWebhookDispatch() — revoke
 *   [WH-11]  applyWebhookDispatch() — ignore
 *   [WH-12]  applyWebhookDispatch() — missing slug
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  WebhookVerificationError,
  extractSlugFromEvent,
  processStripeEvent,
  applyWebhookDispatch,
} from '../../lib/webhooks.js';

import { BILLING_STATUS } from '../../lib/billing.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(type, obj) {
  return { type, data: { object: obj } };
}

function makeIndex(slug, overrides = {}) {
  return {
    [slug]: {
      slug,
      tier: 'free',
      adEnabled: true,
      billingStatus: BILLING_STATUS.PENDING,
      checkoutSessionId: `cs_test_${slug}`,
      subscriptionId: null,
      customerId: null,
      ...overrides,
    },
  };
}

/** Simple in-memory lock for testing */
async function withLock(fn) { return fn(); }

// ── [WH-01] WebhookVerificationError ──────────────────────────────────────────

describe('[WH-01] WebhookVerificationError', () => {
  test('is an Error subclass', () => {
    const e = new WebhookVerificationError('test');
    assert.ok(e instanceof Error);
  });

  test('has name WebhookVerificationError', () => {
    const e = new WebhookVerificationError('test');
    assert.equal(e.name, 'WebhookVerificationError');
  });
});

// ── [WH-02] extractSlugFromEvent() ────────────────────────────────────────────

describe('[WH-02] extractSlugFromEvent()', () => {
  test('extracts slug from metadata', () => {
    const event = makeEvent('checkout.session.completed', {
      metadata: { mdpage_slug: 'my-article' },
    });
    assert.equal(extractSlugFromEvent(event), 'my-article');
  });

  test('returns null when no metadata', () => {
    const event = makeEvent('checkout.session.completed', {});
    assert.equal(extractSlugFromEvent(event), null);
  });

  test('returns null when metadata has no mdpage_slug', () => {
    const event = makeEvent('checkout.session.completed', {
      metadata: { other: 'value' },
    });
    assert.equal(extractSlugFromEvent(event), null);
  });
});

// ── [WH-03] processStripeEvent — checkout.session.completed ───────────────────

describe('[WH-03] checkout.session.completed', () => {
  test('paid checkout → action=grant', () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_123',
      payment_status: 'paid',
      customer: 'cus_xyz',
      subscription: 'sub_abc',
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'grant');
    assert.equal(r.slug, 'my-article');
    assert.equal(r.entitlement.checkoutSessionId, 'cs_123');
    assert.equal(r.entitlement.customerId, 'cus_xyz');
    assert.equal(r.entitlement.subscriptionId, 'sub_abc');
    assert.equal(r.entitlement.provider, 'stripe');
  });

  test('unpaid checkout → action=ignore', () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_123',
      payment_status: 'unpaid',
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'ignore');
  });
});

// ── [WH-04] payment_intent.payment_failed ─────────────────────────────────────

describe('[WH-04] payment_intent.payment_failed', () => {
  test('→ action=update, billingStatus=pending', () => {
    const event = makeEvent('payment_intent.payment_failed', {
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'update');
    assert.equal(r.billingStatus, BILLING_STATUS.PENDING);
  });
});

// ── [WH-05] charge.refunded ────────────────────────────────────────────────────

describe('[WH-05] charge.refunded', () => {
  test('→ action=revoke, revokeReason=refunded', () => {
    const event = makeEvent('charge.refunded', {
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'revoke');
    assert.equal(r.revokeReason, BILLING_STATUS.REFUNDED);
  });
});

// ── [WH-06] customer.subscription.deleted ─────────────────────────────────────

describe('[WH-06] customer.subscription.deleted', () => {
  test('→ action=revoke, revokeReason=expired', () => {
    const event = makeEvent('customer.subscription.deleted', {
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'revoke');
    assert.equal(r.revokeReason, BILLING_STATUS.EXPIRED);
  });
});

// ── [WH-07] customer.subscription.updated ─────────────────────────────────────

describe('[WH-07] customer.subscription.updated', () => {
  test('cancel_at_period_end=true → action=update, billingStatus=cancelled', () => {
    const event = makeEvent('customer.subscription.updated', {
      cancel_at_period_end: true,
      status: 'active',
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'update');
    assert.equal(r.billingStatus, BILLING_STATUS.CANCELLED);
  });

  test('still active → action=ignore', () => {
    const event = makeEvent('customer.subscription.updated', {
      cancel_at_period_end: false,
      status: 'active',
      metadata: { mdpage_slug: 'my-article' },
    });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'ignore');
  });
});

// ── [WH-08] unknown events ────────────────────────────────────────────────────

describe('[WH-08] unknown event types', () => {
  test('unrecognised type → action=ignore', () => {
    const event = makeEvent('invoice.paid', { metadata: { mdpage_slug: 'my-article' } });
    const r = processStripeEvent(event);
    assert.equal(r.action, 'ignore');
  });
});

// ── [WH-09] applyWebhookDispatch — grant ──────────────────────────────────────

describe('[WH-09] applyWebhookDispatch grant', () => {
  test('grant upgrades article to paid', async () => {
    const slug = 'test-article';
    let index = makeIndex(slug);
    const loadIndex  = async () => ({ ...index });
    const saveIndex  = async (i) => { index = i; };

    const dispatch = {
      action: 'grant',
      slug,
      reason: 'checkout.session.completed',
      entitlement: {
        checkoutSessionId: 'cs_new',
        subscriptionId:    'sub_new',
        customerId:        'cus_new',
        provider:          'stripe',
      },
      revokeReason: null,
    };

    const result = await applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock);

    assert.equal(result.ok, true);
    assert.equal(result.action, 'grant');
    assert.equal(index[slug].tier, 'paid');
    assert.equal(index[slug].adEnabled, false);
    assert.equal(index[slug].billingStatus, BILLING_STATUS.ACTIVE);
    assert.equal(index[slug].checkoutSessionId, 'cs_new');
  });
});

// ── [WH-10] applyWebhookDispatch — revoke ─────────────────────────────────────

describe('[WH-10] applyWebhookDispatch revoke', () => {
  test('revoke returns article to free tier', async () => {
    const slug = 'paid-article';
    let index = makeIndex(slug, { tier: 'paid', adEnabled: false, billingStatus: BILLING_STATUS.ACTIVE });
    const loadIndex  = async () => ({ ...index });
    const saveIndex  = async (i) => { index = i; };

    const dispatch = {
      action:       'revoke',
      slug,
      reason:       'charge.refunded',
      entitlement:  null,
      revokeReason: BILLING_STATUS.REFUNDED,
    };

    const result = await applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock);

    assert.equal(result.ok, true);
    assert.equal(index[slug].tier, 'free');
    assert.equal(index[slug].adEnabled, true);
    assert.equal(index[slug].billingStatus, BILLING_STATUS.REFUNDED);
  });
});

// ── [WH-11] applyWebhookDispatch — ignore ─────────────────────────────────────

describe('[WH-11] applyWebhookDispatch ignore', () => {
  test('ignore does not modify index', async () => {
    const slug = 'test-article';
    let index = makeIndex(slug);
    const original = JSON.stringify(index);
    const loadIndex  = async () => ({ ...index });
    const saveIndex  = async (i) => { index = i; };

    const dispatch = { action: 'ignore', slug, reason: 'not interesting' };
    const result = await applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock);

    assert.equal(result.ok, true);
    assert.equal(result.action, 'ignore');
    assert.equal(JSON.stringify(index), original);
  });
});

// ── [WH-12] applyWebhookDispatch — missing slug ───────────────────────────────

describe('[WH-12] applyWebhookDispatch missing slug', () => {
  test('no slug → ok=false', async () => {
    const loadIndex  = async () => ({});
    const saveIndex  = async () => {};

    const dispatch = { action: 'grant', slug: null, reason: 'no slug', entitlement: {} };
    const result = await applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock);

    assert.equal(result.ok, false);
  });

  test('slug not in index → ok=false', async () => {
    const loadIndex  = async () => ({});
    const saveIndex  = async () => {};

    const dispatch = {
      action:       'grant',
      slug:         'missing-slug',
      reason:       'checkout.session.completed',
      entitlement:  { checkoutSessionId: 'cs_1', provider: 'stripe' },
      revokeReason: null,
    };
    const result = await applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock);
    assert.equal(result.ok, false);
  });
});
