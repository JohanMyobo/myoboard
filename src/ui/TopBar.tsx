import { useEffect, useState } from 'react'
import { Check, Download, FilePlus2, Link, Redo2, Undo2 } from 'lucide-react'
import type { Peer } from '../hooks'
import type { Identity } from '../sync/identity'
import type { ConnectionStatus } from '../sync/session'

interface TopBarProps {
  title: string
  onRename(title: string): void
  identity: Identity
  onRenameSelf(): void
  peers: Peer[]
  status: ConnectionStatus
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  onExport(): void
  onNewBoard(): void
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live — changes sync instantly',
  connecting: 'Connecting… changes are kept locally',
  disconnected: 'Offline — changes are kept locally and sync on reconnect',
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

export function TopBar(props: TopBarProps) {
  const { title, onRename, identity, onRenameSelf, peers, status, canUndo, canRedo, onUndo, onRedo, onExport, onNewBoard } = props
  const [draft, setDraft] = useState(title)
  const [copied, setCopied] = useState(false)

  useEffect(() => setDraft(title), [title])

  const commit = () => {
    const next = draft.trim()
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
    } catch {
      window.prompt('Copy this link to share the board', location.href)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <header className="topbar">
      <div className="panel topbar-group">
        <span className="brand" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 32 32">
            <rect x="3" y="3" width="26" height="26" rx="6" fill="#1d1d1b" />
            <path d="M10 9h12a1 1 0 0 1 1 1v8l-5 5h-8a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" fill="#ffd166" />
            <path d="M23 18h-4a1 1 0 0 0-1 1v4z" fill="#e0a800" />
          </svg>
        </span>
        <input
          className="title-input"
          aria-label="Board title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(title)
              e.currentTarget.blur()
            }
          }}
        />
        <span className={`status-dot ${status}`} role="status" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} />
      </div>

      <div className="panel topbar-group">
        <div className="avatars" aria-label={`${peers.length + 1} on this board`}>
          <button type="button" className="avatar self" style={{ background: identity.color }} title={`${identity.name} (you) — click to rename`} onClick={onRenameSelf}>
            {initials(identity.name)}
          </button>
          {peers.slice(0, 5).map((peer) => (
            <span key={peer.clientId} className="avatar" style={{ background: peer.user.color }} title={peer.user.name}>
              {initials(peer.user.name)}
            </span>
          ))}
          {peers.length > 5 && <span className="avatar more">+{peers.length - 5}</span>}
        </div>
        <span className="divider" />
        <button type="button" className="icon-button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="Export PNG" title="Export as PNG" onClick={onExport}>
          <Download size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="New board" title="New board" onClick={onNewBoard}>
          <FilePlus2 size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="primary-button" onClick={share}>
          {copied ? <Check size={16} strokeWidth={2} /> : <Link size={16} strokeWidth={2} />}
          {copied ? 'Link copied' : 'Share'}
        </button>
      </div>
    </header>
  )
}
