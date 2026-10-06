import { useEffect, useState } from 'react'
import { Download, Eye, FilePlus2, Redo2, Undo2, UserPlus } from 'lucide-react'
import type { User } from '../api'
import type { Peer } from '../hooks'
import type { ConnectionStatus } from '../sync/session'
import { BrandMark } from './Brand'
import { UserMenu, initials } from './UserMenu'

interface TopBarProps {
  title: string
  onRename(title: string): void
  /** A viewer: no renaming, undo or new content. */
  readOnly: boolean
  user: User
  onSignOut(): void
  peers: Peer[]
  status: ConnectionStatus
  canUndo: boolean
  canRedo: boolean
  onUndo(): void
  onRedo(): void
  onExport(): void
  onNewBoard(): void
  onShare(): void
  onHome(): void
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live — changes sync instantly',
  connecting: 'Connecting… changes are kept locally',
  disconnected: 'Offline — changes are kept locally and sync on reconnect',
}

export function TopBar(props: TopBarProps) {
  const { title, onRename, readOnly, user, onSignOut, peers, status, canUndo, canRedo, onUndo, onRedo, onExport, onNewBoard, onShare, onHome } = props
  const [draft, setDraft] = useState(title)

  useEffect(() => setDraft(title), [title])

  const commit = () => {
    const next = draft.trim()
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }

  return (
    <header className="topbar">
      <div className="panel topbar-group">
        <a
          className="brand"
          href="/"
          title="All boards"
          aria-label="All boards"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return
            e.preventDefault()
            onHome()
          }}
        >
          <BrandMark />
        </a>
        <input
          className="title-input"
          aria-label="Board title"
          value={draft}
          readOnly={readOnly}
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
        {readOnly && (
          <span className="view-only" title="You can view this board, not change it">
            <Eye size={14} strokeWidth={2} />
            View only
          </span>
        )}
        <span className={`status-dot ${status}`} role="status" aria-label={STATUS_LABEL[status]} title={STATUS_LABEL[status]} />
      </div>

      <div className="panel topbar-group">
        <div className="avatars" aria-label={`${peers.length + 1} on this board`}>
          <UserMenu user={user} onSignOut={onSignOut} />
          {peers.slice(0, 5).map((peer) => (
            <span key={peer.clientId} className="avatar" style={{ background: peer.user.color }} title={peer.user.name}>
              {initials(peer.user.name)}
            </span>
          ))}
          {peers.length > 5 && <span className="avatar more">+{peers.length - 5}</span>}
        </div>
        <span className="divider" />
        {!readOnly && (
          <>
            <button type="button" className="icon-button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={onUndo}>
              <Undo2 size={18} strokeWidth={1.75} />
            </button>
            <button type="button" className="icon-button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={onRedo}>
              <Redo2 size={18} strokeWidth={1.75} />
            </button>
          </>
        )}
        <button type="button" className="icon-button" aria-label="Export PNG" title="Export as PNG" onClick={onExport}>
          <Download size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="New board" title="New board" onClick={onNewBoard}>
          <FilePlus2 size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="primary-button" onClick={onShare}>
          <UserPlus size={16} strokeWidth={2} />
          Share
        </button>
      </div>
    </header>
  )
}
