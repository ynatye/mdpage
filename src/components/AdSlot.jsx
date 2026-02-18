/**
 * AdSlot — placeholder ad unit for free-tier articles.
 *
 * In Phase 1 this renders a clearly-labeled placeholder so the layout is
 * reserved and the slot contract is established.  Replace the inner content
 * with a real ad tag (e.g. Google AdSense, Carbon) when ready.
 *
 * Variants:
 *   "banner"   — horizontal strip, used above content and in the footer
 *   "inline"   — narrower strip that sits inside the article flow
 */
import React from 'react'

const SLOT_STYLES = {
  banner: 'w-full h-[90px]',
  inline: 'w-full h-[120px]',
}

export default function AdSlot({ variant = 'banner', label }) {
  const sizeClass = SLOT_STYLES[variant] ?? SLOT_STYLES.banner

  return (
    <div
      aria-label={label ?? 'Advertisement'}
      className={`${sizeClass} flex items-center justify-center rounded border border-dashed border-border bg-muted/30 text-muted-foreground select-none my-6`}
    >
      <span className="text-xs tracking-widest uppercase opacity-50">
        {label ?? 'Advertisement'}
      </span>
    </div>
  )
}
