import React from 'react'

export default function MdpageLogo({ className = 'h-7 w-auto' }) {
  return (
    <svg
      viewBox="0 0 560 96"
      role="img"
      aria-label="mdpage"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="74"
        fill="currentColor"
        fontFamily="Inter, Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize="78"
        fontWeight="700"
        letterSpacing="-1"
      >
        .mdpage
      </text>
    </svg>
  )
}
