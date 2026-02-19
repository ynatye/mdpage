/**
 * lib/webhooks.js — Webhook event processing
 *
 * Handles inbound webhook events from payment providers.
 * Currently supports: Stripe
 *
 * Security:
 *   - Stripe webhooks are verified via HMAC signature (STRIPE_WEBHOOK_SECRET)
 *   - Raw request body is required for signature verification (cannot use parsed JSON)
 *   - Events that fail verification are rejected with 400
 *
 * Supported Stripe events:
 *   checkout.session.completed     → grant paid entitlement
 *   payment_intent.payment_failed  → log + mark billing issue
 *   charge.refunded                → revoke entitlement (refunded)
 *   customer.subscription.deleted  → revoke entitlement (expired/cancelled)
 *   customer.subscription.updated  → update billing status (cancelled/active)
 *
 * When BILLING_PROVIDER=none, the webhook endpoint is registered but
 * immediately returns 200 with { received: true, skipped: true } so the
 * server can still boot and be tested without a live provider.
 */

import { billingConfig, applyEntitlement, revokeEntitlement, BILLING_STATUS } from './billing.js';
import log from './logger.js';

// ── Signature verification ────────────────────────────────────────────────────

export class WebhookVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/**
 * Verify a Stripe webhook signature.
 * Uses the raw request body (Buffer) and the Stripe-Signature header.
 *
 * @param {Buffer}  rawBody        — raw request body bytes
 * @param {string}  signature      — value of `Stripe-Signature` header
 * @param {string}  secret         — STRIPE_WEBHOOK_SECRET
 * @returns {object}               — parsed Stripe event
 * @throws {WebhookVerificationError}
 */
export async function verifyStripeWebhook(rawBody, signature, secret) {
  if (!secret) {
    throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET is not set');
  }
  if (!signature) {
    throw new WebhookVerificationError('Missing Stripe-Signature header');
  }

  // Dynamically import stripe to avoid hard dependency
  let Stripe;
  try {
    const mod = await import('stripe');
    Stripe = mod.default ?? mod;
  } catch {
    throw new WebhookVerificationError('Stripe SDK not installed (run: npm install stripe)');
  }

  const client = new Stripe(billingConfig.stripe.secretKey ?? '', { apiVersion: '2024-04-10' });

  try {
    const event = client.webhooks.constructEvent(rawBody, signature, secret);
    return event;
  } catch (err) {
    throw new WebhookVerificationError(`Stripe signature verification failed: ${err.message}`);
  }
}

// ── Event dispatch ────────────────────────────────────────────────────────────

/**
 * Extract the article slug from a Stripe event.
 * Looks in multiple places depending on event type.
 *
 * @param {object} event — Stripe event object
 * @returns {string|null}
 */
export function extractSlugFromEvent(event) {
  const obj = event.data?.object ?? {};

  // Prefer explicit metadata
  const slug = obj.metadata?.mdpage_slug
    ?? obj.payment_intent?.metadata?.mdpage_slug
    ?? null;

  return slug ?? null;
}

/**
 * Process a verified Stripe event and return the entitlement action to take.
 *
 * This function is intentionally pure — it does NOT touch the index.
 * The caller is responsible for persisting the result.
 *
 * @param {object} event — verified Stripe event
 * @returns {{
 *   action:      'grant' | 'revoke' | 'update' | 'ignore',
 *   slug:        string|null,
 *   reason:      string,
 *   entitlement: object|null,   — for 'grant'
 *   revokeReason: string|null,  — for 'revoke'
 * }}
 */
export function processStripeEvent(event) {
  const type = event.type;
  const obj  = event.data?.object ?? {};
  const slug = extractSlugFromEvent(event);

  switch (type) {
    case 'checkout.session.completed': {
      if (obj.payment_status !== 'paid') {
        return { action: 'ignore', slug, reason: `checkout.session.completed but payment_status=${obj.payment_status}` };
      }
      return {
        action:      'grant',
        slug,
        reason:      'checkout.session.completed',
        entitlement: {
          checkoutSessionId: obj.id,
          subscriptionId:    obj.subscription ?? null,
          customerId:        obj.customer ?? null,
          provider:          'stripe',
        },
        revokeReason: null,
      };
    }

    case 'payment_intent.payment_failed': {
      return {
        action:       'update',
        slug,
        reason:       'payment_intent.payment_failed',
        billingStatus: BILLING_STATUS.PENDING,   // stay pending — user may retry
        entitlement:  null,
        revokeReason: null,
      };
    }

    case 'charge.refunded': {
      return {
        action:       'revoke',
        slug,
        reason:       'charge.refunded',
        entitlement:  null,
        revokeReason: BILLING_STATUS.REFUNDED,
      };
    }

    case 'customer.subscription.deleted': {
      return {
        action:       'revoke',
        slug,
        reason:       'customer.subscription.deleted',
        entitlement:  null,
        revokeReason: BILLING_STATUS.EXPIRED,
      };
    }

    case 'customer.subscription.updated': {
      const cancelAtPeriodEnd = obj.cancel_at_period_end ?? false;
      const status = obj.status;

      if (status === 'active' && !cancelAtPeriodEnd) {
        return { action: 'ignore', slug, reason: 'subscription still active' };
      }
      if (cancelAtPeriodEnd || status === 'canceled') {
        return {
          action:       'update',
          slug,
          reason:       `subscription.updated cancel_at_period_end=${cancelAtPeriodEnd} status=${status}`,
          billingStatus: BILLING_STATUS.CANCELLED,
          entitlement:  null,
          revokeReason: null,
        };
      }
      return { action: 'ignore', slug, reason: `subscription.updated status=${status}` };
    }

    default:
      return { action: 'ignore', slug, reason: `unhandled event type: ${type}` };
  }
}

// ── Index update helpers ───────────────────────────────────────────────────────

/**
 * Apply a webhook dispatch result to the article index.
 * Caller must supply loadIndex / saveIndex / withLock.
 *
 * @param {object} dispatch   — result from processStripeEvent()
 * @param {Function} loadIndex
 * @param {Function} saveIndex
 * @param {Function} withLock
 * @returns {Promise<{ ok: boolean, slug: string|null, action: string, message: string }>}
 */
export async function applyWebhookDispatch(dispatch, loadIndex, saveIndex, withLock) {
  const { action, slug, reason, entitlement, revokeReason, billingStatus } = dispatch;

  log.info('webhook.dispatch', { action, slug, reason });

  if (action === 'ignore') {
    return { ok: true, slug, action: 'ignore', message: reason };
  }

  if (!slug) {
    log.warn('webhook.dispatch.no_slug', { action, reason });
    return { ok: false, slug: null, action, message: 'No mdpage_slug in event metadata' };
  }

  let result = { ok: false, slug, action, message: 'no-op' };

  await withLock(async () => {
    const index = await loadIndex();
    const article = index[slug];

    if (!article) {
      log.warn('webhook.dispatch.slug_not_found', { slug, action });
      result = { ok: false, slug, action, message: `Slug "${slug}" not found in index` };
      return;
    }

    let updated;

    if (action === 'grant') {
      updated = applyEntitlement(article, entitlement);
      log.info('webhook.entitlement.granted', { slug });
    } else if (action === 'revoke') {
      updated = revokeEntitlement(article, revokeReason);
      log.info('webhook.entitlement.revoked', { slug, revokeReason });
    } else if (action === 'update') {
      updated = {
        ...article,
        billingStatus: billingStatus ?? article.billingStatus,
        updatedAt: new Date().toISOString(),
      };
      log.info('webhook.billing_status.updated', { slug, billingStatus });
    }

    index[slug] = updated;
    await saveIndex(index);
    result = { ok: true, slug, action, message: reason };
  });

  return result;
}
