/**
 * tests/unit/checkout.test.js
 *
 * Unit tests for lib/checkout.js
 *
 * Coverage tags:
 *   [CO-01]  createCheckoutSession — stub mode (provider=none)
 *   [CO-02]  hasPendingCheckout()
 *   [CO-03]  CheckoutError
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCheckoutSession,
  hasPendingCheckout,
  CheckoutError,
} from '../../lib/checkout.js';

import { BILLING_STATUS } from '../../lib/billing.js';

// ── [CO-01] createCheckoutSession — stub mode ────────────────────────────────

describe('[CO-01] createCheckoutSession (stub/none mode)', () => {
  const slug = 'test-article';
  const meta = { title: 'Test Article', slug };
  const options = { origin: 'http://localhost:3456' };

  test('returns an object with sessionId', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.ok(typeof s.sessionId === 'string');
    assert.ok(s.sessionId.length > 0);
  });

  test('sessionId is unique across calls', async () => {
    const a = await createCheckoutSession(slug, meta, options);
    const b = await createCheckoutSession(slug, meta, options);
    assert.notEqual(a.sessionId, b.sessionId);
  });

  test('returns a url string', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.ok(typeof s.url === 'string');
    assert.ok(s.url.startsWith('http'));
  });

  test('stub=true in none mode', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.equal(s.stub, true);
  });

  test('provider=none in none mode', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.equal(s.provider, 'none');
  });

  test('returns slug in response', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.equal(s.slug, slug);
  });

  test('amountCents is a positive integer', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.ok(typeof s.amountCents === 'number');
    assert.ok(s.amountCents > 0);
  });

  test('currency is a non-empty string', async () => {
    const s = await createCheckoutSession(slug, meta, options);
    assert.ok(typeof s.currency === 'string');
    assert.ok(s.currency.length > 0);
  });

  test('uses provided successUrl when given', async () => {
    const custom = await createCheckoutSession(slug, meta, {
      ...options,
      successUrl: 'http://example.com/success',
    });
    // Stub uses successUrl directly as the redirect url
    assert.equal(custom.url, 'http://example.com/success');
  });
});

// ── [CO-02] hasPendingCheckout() ─────────────────────────────────────────────

describe('[CO-02] hasPendingCheckout()', () => {
  test('pending status → true', () => {
    assert.equal(hasPendingCheckout({ billingStatus: BILLING_STATUS.PENDING }), true);
  });

  test('none status → false', () => {
    assert.equal(hasPendingCheckout({ billingStatus: BILLING_STATUS.NONE }), false);
  });

  test('active status → false', () => {
    assert.equal(hasPendingCheckout({ billingStatus: BILLING_STATUS.ACTIVE }), false);
  });

  test('no billingStatus → false', () => {
    assert.equal(hasPendingCheckout({}), false);
  });
});

// ── [CO-03] CheckoutError ──────────────────────────────────────────────────────

describe('[CO-03] CheckoutError', () => {
  test('is an Error subclass', () => {
    const e = new CheckoutError('test', 'test_code');
    assert.ok(e instanceof Error);
  });

  test('has name CheckoutError', () => {
    const e = new CheckoutError('test', 'test_code');
    assert.equal(e.name, 'CheckoutError');
  });

  test('has code field', () => {
    const e = new CheckoutError('test message', 'missing_key');
    assert.equal(e.code, 'missing_key');
  });

  test('has message field', () => {
    const e = new CheckoutError('test message', 'missing_key');
    assert.equal(e.message, 'test message');
  });
});
