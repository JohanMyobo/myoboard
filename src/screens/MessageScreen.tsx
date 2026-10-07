import type { ReactNode } from 'react'
import { Brand } from '../ui/Brand'

interface MessageScreenProps {
  title: string
  children: ReactNode
  actions: { label: string; onClick(): void; primary?: boolean }[]
}

/** A full-page message: board not found, no access, server unreachable. */
export function MessageScreen({ title, children, actions }: MessageScreenProps) {
  return (
    <main className="page-center">
      <div className="panel message-card" role="alert">
        <Brand />
        <h1>{title}</h1>
        <p>{children}</p>
        <div className="message-actions">
          {actions.map((action, i) => (
            <button key={action.label} type="button" className={i === 0 || action.primary ? 'primary-button' : 'secondary-button'} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
