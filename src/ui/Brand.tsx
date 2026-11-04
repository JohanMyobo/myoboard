/** The Myoboard mark: a folded sticky note on a navy tile, in the Myobo blues. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="3" y="3" width="26" height="26" rx="6" fill="#0d3272" />
      <path d="M10 9h12a1 1 0 0 1 1 1v8l-5 5h-8a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" fill="#38b6ff" />
      <path d="M23 18h-4a1 1 0 0 0-1 1v4z" fill="#1b86cc" />
    </svg>
  )
}

export function Brand() {
  return (
    <span className="brand-lockup">
      <BrandMark size={26} />
      <span>Myoboard</span>
    </span>
  )
}
