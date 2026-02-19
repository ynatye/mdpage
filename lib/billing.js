/**
 * lib/billing.js — Billing plan definitions and configuration plumbing
 *
 * This module defines the billing model (plans, entitlements) and provides
 * helpers for reading/writing billing metadata in the article index.
 *
 * It intentionally contains NO payment-provider I/O — that lives in
 * lib/checkout.js and lib/webhooks.js. This layer is pure schema + config.
 *
 * Plans
 * ─────
 *   free   — ad-supported, lifecycle-expiry, random-suffix slug
 *   paid   — ad-free, permanent, clean slug (one-time purchase or subscription)
 *
 * Billing status on an article record
 * ────────────────────────────────────
 *   billingStatus: 'none'       — free post, no billing required
 *                  'pending'    — checkout initiated, not yet confirmed
 *                  'active'     — paid entitlement confirmed and active
 *                  'cancelled'  — subscription cancelled (still active until period end)
 *                  'expired'    — subscription lapsed; article reverts to free behaviour
 *                  'refunded'   — payment refunded; entitlement withdrawn
 *
 * Environment variables
 * ──────────────────────
 *   BILLING_PROVIDER         — 'stripe' | 'none' (default: 'none')
 *   STRIPE_SECRET_KEY        — Stripe secret key (sk_live_* or sk_test_*)
 *   STRIPE_PUBLISHABLE_KEY   — Stripe publishable key (pk_live_* or pk_test_*)
 *   STRIPE_WEBHOOK_SECRET    — Stripe webhook signing secret (whsec_*)
 *   BILLING_PAID_PRICE_ID    — Stripe Price ID for the paid plan
 *   BILLING_SUCCESS_URL      — Redirect URL after successful checkout
 *   BILLING_CANCEL_URL       — Redirect URL if checkout is abandoned
 *   BILLING_CURRENCY         — ISO-4217 currency code (default: 'usd')
 *   BILLING_AMOUNT_CENTS     — One-time price in cents (used when no price ID set; default: 900)
 */

import log from './logger.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const billingConfig = {
  /** Which payment provider is active. 'none' means billing UI shows but no charges are made. */
  provider: (process.env.BILLING_PROVIDER ?? 'none').toLowerCase(),

  stripe: {
    secretKey:       process.env.STRIPE_SECRET_KEY       ?? null,
    publishableKey:  process.env.STRIPE_PUBLISHABLE_KEY  ?? null,
    webhookSecret:   process.env.STRIPE_WEBHOOK_SECRET   ?? null,
    paidPriceId:     process.env.BILLING_PAID_PRICE_ID   ?? null,
  },

  successUrl:    process.env.BILLING_SUCCESS_URL   ?? null,
  cancelUrl:     process.env.BILLING_CANCEL_URL    ?? null,
  currency:      process.env.BILLING_CURRENCY      ?? 'usd',
  amountCents:   parseInt(process.env.BILLING_AMOUNT_CENTS ?? '900', 10),
};

// ── Plan definitions ──────────────────────────────────────────────────────────

export const PLANS = {
  free: {
    id:          'free',
    label:       'Free',
    adEnabled:   true,
    lifecycle:   true,    // subject to expiry
    cleanSlug:   false,
    permanent:   false,
  },
  paid: {
    id:          'paid',
    label:       'Paid',
    adEnabled:   false,
    lifecycle:   false,   // never expires
    cleanSlug:   true,
    permanent:   true,
  },
};

// ── Billing status constants ───────────────────────────────────────────────────

export const BILLING_STATUS = {
  NONE:       'none',
  PENDING:    'pending',
  ACTIVE:     'active',
  CANCELLED:  'cancelled',
  EXPIRED:    'expired',
  REFUNDED:   'refunded',
};

export const VALID_BILLING_STATUSES = new Set(Object.values(BILLING_STATUS));

// ── Schema helpers ────────────────────────────────────────────────────────────

/**
 * Build the default billing metadata block for a newly published article.
 *
 * @param {'free'|'paid'} tier
 * @returns {object}
 */
export function defaultBillingMeta(tier) {
  return {
    billingStatus:    tier === 'paid' ? BILLING_STATUS.ACTIVE : BILLING_STATUS.NONE,
    checkoutSessionId: null,
    subscriptionId:   null,
    customerId:       null,
    planActivatedAt:  tier === 'paid' ? new Date().toISOString() : null,
    planExpiresAt:    null,
    billingProvider:  tier === 'paid' ? billingConfig.provider : null,
  };
}

/**
 * Apply a billing entitlement grant to an article metadata record.
 * Does NOT persist — caller saves the updated record.
 *
 * @param {object} meta           — existing article metadata
 * @param {object} entitlement    — { checkoutSessionId, subscriptionId, customerId, provider }
 * @param {Date}   [now]
 * @returns {object}              — updated metadata
 */
export function applyEntitlement(meta, entitlement, now = new Date()) {
  const updated = {
    ...meta,
    tier:              'paid',
    adEnabled:         false,
    billingStatus:     BILLING_STATUS.ACTIVE,
    checkoutSessionId: entitlement.checkoutSessionId ?? meta.checkoutSessionId,
    subscriptionId:    entitlement.subscriptionId    ?? meta.subscriptionId,
    customerId:        entitlement.customerId        ?? meta.customerId,
    planActivatedAt:   meta.planActivatedAt          ?? now.toISOString(),
    billingProvider:   entitlement.provider          ?? billingConfig.provider,
    updatedAt:         now.toISOString(),
  };

  log.info('billing.entitlement.granted', {
    slug:              meta.slug,
    checkoutSessionId: entitlement.checkoutSessionId,
    subscriptionId:    entitlement.subscriptionId,
    provider:          entitlement.provider,
  });

  return updated;
}

/**
 * Revoke a billing entitlement (refund / subscription lapse).
 * Articles revert to free-tier behaviour.
 *
 * @param {object} meta         — existing article metadata
 * @param {'refunded'|'expired'} reason
 * @param {Date}   [now]
 * @returns {object}            — updated metadata
 */
export function revokeEntitlement(meta, reason = BILLING_STATUS.REFUNDED, now = new Date()) {
  if (!VALID_BILLING_STATUSES.has(reason)) {
    reason = BILLING_STATUS.REFUNDED;
  }

  const updated = {
    ...meta,
    tier:          'free',
    adEnabled:     true,
    billingStatus: reason,
    planExpiresAt: now.toISOString(),
    updatedAt:     now.toISOString(),
  };

  log.info('billing.entitlement.revoked', {
    slug:   meta.slug,
    reason,
    wasSubscriptionId: meta.subscriptionId,
  });

  return updated;
}

/**
 * Return true if the article currently has an active paid entitlement.
 * An article can be "paid" tier without a billing record (e.g. legacy data).
 *
 * @param {object} meta
 * @returns {boolean}
 */
export function hasActiveEntitlement(meta) {
  if (meta.tier !== 'paid') return false;
  // Legacy paid posts without billing metadata are treated as active.
  if (!meta.billingStatus || meta.billingStatus === BILLING_STATUS.NONE) return true;
  return meta.billingStatus === BILLING_STATUS.ACTIVE ||
         meta.billingStatus === BILLING_STATUS.CANCELLED; // cancelled but still in period
}

// ── Config validation + readiness ─────────────────────────────────────────────

/**
 * Returns a readiness report for the billing subsystem.
 * Used by /api/internal/billing-config and startup diagnostics.
 *
 * @returns {{ ready: boolean, provider: string, issues: string[] }}
 */
export function billingReadiness() {
  const issues = [];
  const { provider, stripe } = billingConfig;

  if (provider === 'none') {
    return { ready: false, provider: 'none', issues: ['BILLING_PROVIDER not set — billing is disabled'] };
  }

  if (provider === 'stripe') {
    if (!stripe.secretKey)      issues.push('STRIPE_SECRET_KEY is not set');
    if (!stripe.publishableKey) issues.push('STRIPE_PUBLISHABLE_KEY is not set');
    if (!stripe.webhookSecret)  issues.push('STRIPE_WEBHOOK_SECRET is not set (webhooks will reject)');
    if (!stripe.paidPriceId)    issues.push('BILLING_PAID_PRICE_ID is not set (will use BILLING_AMOUNT_CENTS fallback)');
    if (!billingConfig.successUrl) issues.push('BILLING_SUCCESS_URL is not set');
    if (!billingConfig.cancelUrl)  issues.push('BILLING_CANCEL_URL is not set');
  } else {
    issues.push(`Unknown BILLING_PROVIDER: "${provider}"`);
  }

  return {
    ready:    issues.length === 0,
    provider,
    issues,
  };
}
