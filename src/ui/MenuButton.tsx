import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface MenuButtonProps {
  label: string
  icon: ReactNode
  /** A small count or dot on the button. */
  badge?: ReactNode
  active?: boolean
  children(close: () => void): ReactNode
}

/** A top-bar button that opens a panel under it; a click outside or Esc closes it. */
export function MenuButton({ label, icon, badge, active, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-button${active ? ' active' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {badge}
      </button>
      {open && (
        <div className="panel popover menu-popover" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
