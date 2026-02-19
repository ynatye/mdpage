/**
 * lib/checkout.js — Checkout session initiation
 *
 * Creates payment checkout sessions for upgrading an article from free → paid.
 * When BILLING_PROVIDER=stripe and STRIPE_SECRET_KEY is set, this calls the
 * Stripe API to create a real checkout session.
 *
 * When BILLING_PROVIDER=none (default / dev) or keys are missing, it returns
 * a stub session so the flow can be developed and tested without live keys.
 *
 * Important: This module never touches the article index directly — it only
 * returns session details. The entitlement is granted via lib/webhooks.js
 * after the provider confirms payment.
 *
 * Exported:
 *   createCheckoutSession(slug, meta, options) → { sessionId, url, stub }
 */

import { billingConfig, BILLING_STATUS } from './billing.js';
import log from './logger.js';

// ── Stub mode ─────────────────────────────────────────────────────────────────
// Used when no payment provider keys are configured.
// Returns a fake session that lets the frontend build and test the upgrade flow.

function stubSession(slug, options = {}) {
  const sessionId = `stub_cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const successUrl = options.successUrl ?? billingConfig.successUrl
    ?? `${options.origin ?? 'http://localhost:3456'}/checkout/success`;
  const cancelUrl = options.cancelUrl ?? billingConfig.cancelUrl
    ?? `${options.origin ?? 'http://localhost:3456'}/${slug}`;

  log.info('checkout.stub.session', { slug, sessionId });

  return {
    sessionId,
    url:         successUrl,   // stub: redirect straight to success
    stub:        true,
    provider:    'none',
    slug,
    amountCents: billingConfig.amountCents,
    currency:    billingConfig.currency,
  };
}

// ── Stripe session ─────────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session.
 * Dynamically imports the stripe SDK to avoid requiring it when unused.
 *
 * @param {string} slug
 * @param {object} meta    — article metadata (for display in Stripe dashboard)
 * @param {object} options — { successUrl, cancelUrl, origin, customerEmail }
 * @returns {Promise<{ sessionId, url, stub: false, provider: 'stripe' }>}
 */
async function stripeSession(slug, meta, options = {}) {
  const { stripe: stripeCfg } = billingConfig;

  if (!stripeCfg.secretKey) {
    throw new CheckoutError('STRIPE_SECRET_KEY is not set', 'missing_key');
  }

  // Dynamically require stripe — only needed when actually configured.
  let Stripe;
  try {
    const mod = await import('stripe');
    Stripe = mod.default ?? mod;
  } catch {
    throw new CheckoutError(
      'Stripe SDK not installed. Run: npm install stripe',
      'sdk_missing',
    );
  }

  const client = new Stripe(stripeCfg.secretKey, { apiVersion: '2024-04-10' });

  const origin     = options.origin ?? 'http://localhost:3456';
  const successUrl = options.successUrl ?? billingConfig.successUrl
    ?? `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = options.cancelUrl ?? billingConfig.cancelUrl
    ?? `${origin}/${slug}`;

  const lineItems = stripeCfg.paidPriceId
    ? [{ price: stripeCfg.paidPriceId, quantity: 1 }]
    : [{
        price_data: {
          currency:     billingConfig.currency,
          unit_amount:  billingConfig.amountCents,
          product_data: {
            name:        `mdpage Paid Post — ${meta.title ?? slug}`,
            description: 'Ad-free · Clean slug · Permanent retention',
          },
        },
        quantity: 1,
      }];

  const session = await client.checkout.sessions.create({
    payment_method_types: ['card'],
    mode:          'payment',
    line_items:    lineItems,
    success_url:   successUrl,
    cancel_url:    cancelUrl,
    metadata: {
      mdpage_slug: slug,
      mdpage_tier: 'paid',
    },
    ...(options.customerEmail && { customer_email: options.customerEmail }),
  });

  log.info('checkout.stripe.session.created', {
    slug,
    sessionId: session.id,
    url:       session.url,
  });

  return {
    sessionId:   session.id,
    url:         session.url,
    stub:        false,
    provider:    'stripe',
    slug,
    amountCents: billingConfig.amountCents,
    currency:    billingConfig.currency,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export class CheckoutError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

/**
 * Create a checkout session to upgrade the given article to paid tier.
 *
 * @param {string} slug    — article slug
 * @param {object} meta    — article metadata from index
 * @param {object} options — { successUrl, cancelUrl, origin, customerEmail }
 * @returns {Promise<{
 *   sessionId: string,
 *   url: string,
 *   stub: boolean,
 *   provider: string,
 *   slug: string,
 *   amountCents: number,
 *   currency: string,
 * }>}
 */
export async function createCheckoutSession(slug, meta, options = {}) {
  const { provider } = billingConfig;

  if (provider === 'stripe') {
    return stripeSession(slug, meta, options);
  }

  // Default: stub mode
  return stubSession(slug, options);
}

/**
 * Check whether a checkout session is already pending for an article.
 * Prevents stacking multiple open sessions.
 *
 * @param {object} meta — article metadata
 * @returns {boolean}
 */
export function hasPendingCheckout(meta) {
  return meta.billingStatus === BILLING_STATUS.PENDING;
}
