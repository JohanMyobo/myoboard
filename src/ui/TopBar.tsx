import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Download, Eye, FilePlus2, LayoutTemplate, MessageSquare, Redo2, Timer, Undo2, UserPlus, Vote } from 'lucide-react'
import type { User } from '../api'
import type { ExportFormat } from '../canvas/exportBoard'
import type { Peer } from '../hooks'
import type { ConnectionStatus } from '../sync/session'
import { BrandMark } from './Brand'
import { MenuButton } from './MenuButton'
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
  /** How many objects are selected: export can be limited to them. */
  selectionCount: number
  onExport(format: ExportFormat, onlySelection: boolean): void
  onNewBoard(): void
  onShare(): void
  onHome(): void
  openComments: number
  commentsShown: boolean
  onToggleComments(): void
  onTemplates(): void
  /** The timer and vote menus' content (given a way to close the menu); their buttons light up while one runs. */
  timerMenu(close: () => void): ReactNode
  timerActive: boolean
  voteMenu(close: () => void): ReactNode
  voteActive: boolean
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live — changes sync instantly',
  connecting: 'Connecting… changes are kept locally',
  disconnected: 'Offline — changes are kept locally and sync on reconnect',
}

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'png', label: 'PNG image' },
  { format: 'jpg', label: 'JPG image' },
  { format: 'pdf', label: 'PDF document' },
]

function ExportMenu({ selectionCount, onExport, close }: { selectionCount: number; onExport: TopBarProps['onExport']; close(): void }) {
  const [onlySelection, setOnlySelection] = useState(false)
  return (
    <div className="export-menu">
      <span className="menu-title">Export</span>
      {FORMATS.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          className="menu-item"
          onClick={() => {
            onExport(format, onlySelection && selectionCount > 0)
            close()
          }}
        >
          <Download size={16} strokeWidth={1.75} />
          {label}
        </button>
      ))}
      {selectionCount > 0 && (
        <label className="check-row">
          <input type="checkbox" checked={onlySelection} onChange={(e) => setOnlySelection(e.target.checked)} />
          Only the selection ({selectionCount})
        </label>
      )}
    </div>
  )
}

export function TopBar(props: TopBarProps) {
  const { title, onRename, readOnly, user, onSignOut, peers, status, canUndo, canRedo, onUndo, onRedo } = props
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
            props.onHome()
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
            <span className="divider" />
          </>
        )}
        <button
          type="button"
          className={`icon-button${props.commentsShown ? ' active' : ''}`}
          aria-label="Comments"
          title="Comments"
          aria-pressed={props.commentsShown}
          onClick={props.onToggleComments}
        >
          <MessageSquare size={18} strokeWidth={1.75} />
          {props.openComments > 0 && <span className="button-badge">{props.openComments}</span>}
        </button>
        <button type="button" className="icon-button" aria-label="Templates" title="Templates" onClick={props.onTemplates}>
          <LayoutTemplate size={18} strokeWidth={1.75} />
        </button>
        <MenuButton label="Timer" icon={<Timer size={18} strokeWidth={1.75} />} active={props.timerActive}>
          {props.timerMenu}
        </MenuButton>
        <MenuButton label="Vote" icon={<Vote size={18} strokeWidth={1.75} />} active={props.voteActive}>
          {props.voteMenu}
        </MenuButton>
        <span className="divider" />
        <MenuButton label="Export" icon={<Download size={18} strokeWidth={1.75} />}>
          {(close) => <ExportMenu selectionCount={props.selectionCount} onExport={props.onExport} close={close} />}
        </MenuButton>
        <button type="button" className="icon-button" aria-label="New board" title="New board" onClick={props.onNewBoard}>
          <FilePlus2 size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="primary-button" onClick={props.onShare}>
          <UserPlus size={16} strokeWidth={2} />
          Share
        </button>
      </div>
    </header>
  )
}
