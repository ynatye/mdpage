/**
 * AtRiskBanner — warning strip shown on free articles that are at risk of expiry.
 *
 * Props:
 *   expiresAt   — ISO date string from backend (nullable / undefined)
 *   upgradeHref — optional upgrade CTA link (defaults to '/')
 *
 * Defensive: renders a generic warning if expiresAt is absent or invalid.
 */
import React, { useMemo } from 'react'

function parseExpiry(expiresAt) {
  if (!expiresAt) return null
  try {
    const expiry = new Date(expiresAt)
    return isNaN(expiry.getTime()) ? null : expiry
  } catch {
    return null
  }
}

function computeDaysRemaining(expiry) {
  if (!expiry) return null
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  if (diffMs <= 0) return 0
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function formatExpiryDate(expiry) {
  if (!expiry) return null
  return expiry.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function AtRiskBanner({ expiresAt, upgradeHref = '/' }) {
  const expiry = useMemo(() => parseExpiry(expiresAt), [expiresAt])
  const daysLeft = useMemo(() => computeDaysRemaining(expiry), [expiry])
  const expiryDateText = useMemo(() => formatExpiryDate(expiry), [expiry])

  const countdownText =
    daysLeft === null
      ? 'soon'
      : daysLeft === 0
      ? 'today'
      : daysLeft === 1
      ? 'in 1 day'
      : `in ${daysLeft} days`

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-500/40 px-4 py-3 mb-6 text-sm"
      style={{ fontFamily: 'Geist Mono, monospace' }}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-amber-800 dark:text-amber-300 leading-snug">
          <span className="font-semibold">⚠ This post will expire {countdownText}</span>{' '}
          unless it receives more traffic or is upgraded to a paid post.
        </p>
        <a
          href={upgradeHref}
          className="shrink-0 inline-block rounded bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
        >
          Upgrade to Paid
        </a>
      </div>
      <p className="mt-1.5 text-amber-700/70 dark:text-amber-400/60 text-xs">
        {expiryDateText ? `Scheduled expiry date: ${expiryDateText}. ` : ''}
        Paid posts are ad-free, get a clean slug, and are kept permanently.
      </p>
    </div>
  )
}
