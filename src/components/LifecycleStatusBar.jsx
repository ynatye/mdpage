/**
 * LifecycleStatusBar — subtle footer strip for free-tier articles.
 *
 * Shows tier, lifecycle status, and a soft upgrade nudge for at-risk posts.
 * Intentionally unobtrusive — this is not a warning banner, just context.
 *
 * Props:
 *   tier         — "free" | "paid"
 *   status       — "published" | "at_risk" | "expired"
 *   lifecycleUx  — precomputed UX metadata from API { statusLabel, urgency, daysLeftText }
 *   upgradeHref  — upgrade link (default "/")
 */
import React from 'react'

const STATUS_COLORS = {
  published: 'text-green-600 dark:text-green-400',
  at_risk:   'text-amber-600 dark:text-amber-400',
  expired:   'text-red-600 dark:text-red-400',
}

export default function LifecycleStatusBar({ tier, status, lifecycleUx, upgradeHref = '/' }) {
  // Only render for free-tier articles — paid posts need no lifecycle context.
  if (tier !== 'free') return null

  const statusColor  = STATUS_COLORS[status] ?? STATUS_COLORS.published
  const statusLabel  = lifecycleUx?.statusLabel ?? (status === 'at_risk' ? 'At Risk' : 'Published')
  const daysLeftText = lifecycleUx?.daysLeftText

  return (
    <div
      className="flex items-center justify-between gap-4 py-2 px-3 rounded border border-border bg-muted/20 text-xs"
      style={{ fontFamily: 'Geist Mono, monospace' }}
      aria-label="Article lifecycle status"
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="opacity-60">tier:</span>
          <span className="text-foreground">free</span>
        </span>
        <span aria-hidden>·</span>
        <span className="flex items-center gap-1">
          <span className="opacity-60">status:</span>
          <span className={statusColor}>{statusLabel}</span>
        </span>
        {status === 'at_risk' && daysLeftText && (
          <>
            <span aria-hidden>·</span>
            <span className="text-amber-600/80 dark:text-amber-400/80">
              expires {daysLeftText}
            </span>
          </>
        )}
      </div>
      {status === 'at_risk' && (
        <a
          href={upgradeHref}
          className="text-primary hover:opacity-80 font-medium transition-opacity"
        >
          Upgrade →
        </a>
      )}
    </div>
  )
}
