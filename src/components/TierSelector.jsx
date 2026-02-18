/**
 * TierSelector — Free / Paid toggle for the Upload page.
 *
 * Renders as a compact pill toggle. Visually communicates the value
 * difference between tiers without requiring a full modal.
 */
import React from 'react'

const TIERS = [
  {
    value: 'free',
    label: 'Free',
    tooltip: 'Ad-supported · slug gets a random suffix · expires if unread',
  },
  {
    value: 'paid',
    label: 'Paid',
    tooltip: 'Ad-free · clean custom slug · permanent retention',
  },
]

export default function TierSelector({ tier, onChange }) {
  return (
    <div
      className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5"
      role="group"
      aria-label="Publishing tier"
    >
      {TIERS.map((t) => {
        const active = tier === t.value
        return (
          <button
            key={t.value}
            type="button"
            title={t.tooltip}
            aria-pressed={active}
            onClick={() => onChange(t.value)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-150 select-none ${
              active
                ? t.value === 'paid'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
