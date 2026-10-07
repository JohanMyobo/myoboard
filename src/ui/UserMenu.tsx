import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import type { User } from '../api'

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

/** Your avatar; click it to see who you are signed in as, and to sign out. */
export function UserMenu({ user, onSignOut }: { user: User; onSignOut(): void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="avatar self"
        style={{ background: user.color }}
        aria-label={`Signed in as ${user.name}`}
        aria-expanded={open}
        title={`${user.name} (you)`}
        onClick={() => setOpen((o) => !o)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="panel popover user-popover" role="menu">
          <div className="user-popover-who">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <button type="button" className="menu-item" role="menuitem" onClick={onSignOut}>
            <LogOut size={16} strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
