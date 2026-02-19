/**
 * AtRiskBanner — warning strip shown on free articles that are at risk of expiry.
 *
 * Props:
 *   expiresAt    — ISO date string from backend (nullable / undefined)
 *   daysLeft     — precomputed number of days left (from lifecycleUx, nullable)
 *   daysLeftText — human-readable countdown from lifecycleUx (e.g. "in 3 days")
 *   urgency      — 'critical' | 'high' | 'medium' | 'low' (from lifecycleUx)
 *   upgradeHref  — optional upgrade CTA link (defaults to '/')
 *
 * When lifecycleUx props are not passed, the component falls back to
 * computing urgency client-side from expiresAt (backwards-compatible).
 */
import React, { useMemo } from 'react'

// ── Client-side fallback helpers (used when lifecycleUx is not provided) ──────

function parseExpiry(expiresAt) {
  if (!expiresAt) return null
  try {
    const expiry = new Date(expiresAt)
    return isNaN(expiry.getTime()) ? null : expiry
  } catch {
    return null
  }
}

function computeFallbackDaysLeft(expiry) {
  if (!expiry) return null
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function fallbackUrgency(daysLeft) {
  if (daysLeft === null) return 'low'
  if (daysLeft <= 0) return 'critical'
  if (daysLeft <= 2) return 'high'
  if (daysLeft <= 5) return 'medium'
  return 'low'
}

function fallbackDaysLeftText(daysLeft) {
  if (daysLeft === null) return 'soon'
  if (daysLeft <= 0) return 'today'
  if (daysLeft === 1) return 'in 1 day'
  return `in ${daysLeft} days`
}

function formatExpiryDate(expiry) {
  if (!expiry) return null
  return expiry.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Urgency-aware colour palette ─────────────────────────────────────────────

const URGENCY_STYLES = {
  critical: {
    container: 'border-red-400/70 bg-red-50 dark:bg-red-950/30 dark:border-red-500/50',
    text:      'text-red-800 dark:text-red-300',
    subtext:   'text-red-700/70 dark:text-red-400/60',
    btn:       'bg-red-600 hover:bg-red-700',
    icon:      '🚨',
  },
  high: {
    container: 'border-orange-400/70 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-500/50',
    text:      'text-orange-800 dark:text-orange-300',
    subtext:   'text-orange-700/70 dark:text-orange-400/60',
    btn:       'bg-orange-500 hover:bg-orange-600',
    icon:      '⚠️',
  },
  medium: {
    container: 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/40',
    text:      'text-amber-800 dark:text-amber-300',
    subtext:   'text-amber-700/70 dark:text-amber-400/60',
    btn:       'bg-amber-500 hover:bg-amber-600',
    icon:      '⚠',
  },
  low: {
    container: 'border-amber-300/50 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-600/30',
    text:      'text-amber-700 dark:text-amber-400',
    subtext:   'text-amber-600/60 dark:text-amber-500/50',
    btn:       'bg-amber-400 hover:bg-amber-500',
    icon:      '⚠',
  },
}

export default function AtRiskBanner({
  expiresAt,
  daysLeft: daysLeftProp,
  daysLeftText: daysLeftTextProp,
  urgency: urgencyProp,
  upgradeHref = '/',
}) {
  // If the parent passes pre-computed lifecycleUx values, use them directly.
  // Otherwise compute from expiresAt for backwards compatibility.
  const expiry       = useMemo(() => parseExpiry(expiresAt), [expiresAt])
  const daysLeft     = daysLeftProp    ?? useMemo(() => computeFallbackDaysLeft(expiry), [expiry])
  const urgency      = urgencyProp     ?? useMemo(() => fallbackUrgency(daysLeft),       [daysLeft])
  const daysLeftText = daysLeftTextProp ?? useMemo(() => fallbackDaysLeftText(daysLeft),  [daysLeft])
  const expiryDateText = useMemo(() => formatExpiryDate(expiry), [expiry])

  const styles = URGENCY_STYLES[urgency] ?? URGENCY_STYLES.low

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`w-full rounded-md border ${styles.container} px-4 py-3 mb-6 text-sm`}
      style={{ fontFamily: 'Geist Mono, monospace' }}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <p className={`${styles.text} leading-snug`}>
          <span className="font-semibold">
            {styles.icon} This post will expire {daysLeftText}
          </span>{' '}
          unless it receives more traffic or is upgraded to a paid post.
        </p>
        <a
          href={upgradeHref}
          className={`shrink-0 inline-block rounded ${styles.btn} text-white text-xs font-semibold px-3 py-1.5 transition-colors`}
        >
          Upgrade to Paid
        </a>
      </div>
      <p className={`mt-1.5 ${styles.subtext} text-xs`}>
        {expiryDateText ? `Scheduled expiry: ${expiryDateText}. ` : ''}
        Paid posts are ad-free, get a clean slug, and are kept permanently.
      </p>
    </div>
  )
}
