/**
 * UpgradeCTA — Upgrade to Paid call-to-action component.
 *
 * Used in two contexts:
 *   1. Inline upgrade button/modal (e.g. inside AtRiskBanner)
 *   2. Standalone upgrade section on the Expired page
 *
 * Props:
 *   slug        — article slug to upgrade
 *   variant     — 'button' | 'section' (default: 'button')
 *   label       — button label (default: 'Upgrade to Paid')
 *   onSuccess   — callback after checkout session is created (receives { url })
 *   className   — extra classes
 *
 * Checkout flow:
 *   1. POST /api/checkout/session { slug }
 *   2. Redirect to session.url (Stripe checkout or stub success URL)
 *   3. Server webhook grants entitlement (or stub flow confirms immediately)
 */
import React, { useState, useCallback } from 'react'
import { toast } from 'sonner'

export default function UpgradeCTA({
  slug,
  variant = 'button',
  label = 'Upgrade to Paid',
  onSuccess,
  className = '',
}) {
  const [loading, setLoading] = useState(false)

  const handleUpgrade = useCallback(async () => {
    if (!slug) {
      toast.error('No article selected for upgrade')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          toast.error(data.error ?? 'A checkout session is already in progress')
        } else if (res.status === 503) {
          toast.error('Billing is not configured — contact support')
        } else {
          toast.error(data.error ?? 'Failed to start checkout')
        }
        return
      }

      if (onSuccess) onSuccess(data)

      // Redirect to payment provider (or stub success URL in dev)
      if (data.url) {
        if (data.stub) {
          toast.info('Dev mode: billing is stubbed — redirecting to success page')
        }
        window.location.href = data.url
      }
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [slug, onSuccess])

  if (variant === 'section') {
    return (
      <div
        className={`rounded-lg border border-border bg-muted/20 p-6 text-center ${className}`}
        style={{ fontFamily: 'Geist Mono, monospace' }}
      >
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Upgrade to Paid
        </h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
          Paid posts are ad-free, get a clean custom slug, and are kept permanently —
          no traffic requirements.
        </p>
        <ul className="text-sm text-muted-foreground mb-6 space-y-1 text-left max-w-xs mx-auto">
          <li className="flex items-center gap-2">
            <span className="text-green-500">✓</span> No ads
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-500">✓</span> Clean custom slug
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-500">✓</span> Permanent retention
          </li>
          <li className="flex items-center gap-2">
            <span className="text-green-500">✓</span> Never expires
          </li>
        </ul>
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="rounded bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? 'Starting checkout…' : label}
        </button>
      </div>
    )
  }

  // Default: compact button
  return (
    <button
      onClick={handleUpgrade}
      disabled={loading}
      className={`inline-block rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 ${className}`}
    >
      {loading ? 'Starting checkout…' : label}
    </button>
  )
}
