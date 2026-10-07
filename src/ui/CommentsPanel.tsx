import { useState } from 'react'
import { X } from 'lucide-react'
import type { Thread } from '../model/comments'
import { initials } from './UserMenu'
import { timeAgo } from './time'

interface CommentsPanelProps {
  threads: readonly Thread[]
  openId: string | null
  onFocus(id: string): void
  onClose(): void
}

/** Every thread on the board, open or resolved; click one to go to it. */
export function CommentsPanel({ threads, openId, onFocus, onClose }: CommentsPanelProps) {
  const [showing, setShowing] = useState<'open' | 'resolved'>('open')
  const open = threads.filter((t) => !t.resolved)
  const resolved = threads.filter((t) => t.resolved)
  const shown = (showing === 'open' ? open : resolved).slice().reverse()

  return (
    <aside className="panel side-panel" aria-label="Comments">
      <header className="side-panel-header">
        <h2>Comments</h2>
        <button type="button" className="icon-button" aria-label="Close comments" onClick={onClose}>
          <X size={18} strokeWidth={1.75} />
        </button>
      </header>
      <div className="segmented tabs" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={showing === 'open'} aria-pressed={showing === 'open'} onClick={() => setShowing('open')}>
          Open ({open.length})
        </button>
        <button type="button" role="tab" aria-selected={showing === 'resolved'} aria-pressed={showing === 'resolved'} onClick={() => setShowing('resolved')}>
          Resolved ({resolved.length})
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted side-panel-empty">
          {showing === 'open' ? 'No open comments. Pick the comment tool (M) and click anywhere on the board.' : 'Nothing resolved yet.'}
        </p>
      ) : (
        <ul className="thread-list">
          {shown.map((thread) => {
            const first = thread.messages[0]
            const replies = thread.messages.length - 1
            return (
              <li key={thread.id}>
                <button type="button" className={`thread-item${thread.id === openId ? ' current' : ''}`} onClick={() => onFocus(thread.id)}>
                  <span className="avatar small" style={{ background: thread.author.color }}>
                    {initials(thread.author.name)}
                  </span>
                  <span className="thread-summary">
                    <span className="comment-meta">
                      <strong>{thread.author.name}</strong>
                      <span>{timeAgo(first.at)}</span>
                    </span>
                    <span className="thread-text">{first.text}</span>
                    {replies > 0 && <span className="thread-replies">{replies === 1 ? '1 reply' : `${replies} replies`}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
