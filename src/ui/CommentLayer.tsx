import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { CircleCheck, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { toScreen } from '../canvas/camera'
import type { Camera } from '../canvas/camera'
import { pinPosition } from '../model/comments'
import type { CommentAuthor, Comments, Thread } from '../model/comments'
import type { BoardObject } from '../model/types'
import { initials } from './UserMenu'
import { timeAgo } from './time'

export interface CommentDraft {
  x: number
  y: number
  on: string | null
}

interface CommentLayerProps {
  comments: Comments
  threads: readonly Thread[]
  lookup(id: string): BoardObject | undefined
  camera: Camera
  size: { width: number; height: number }
  me: CommentAuthor
  /** Board owners can delete anyone's thread. */
  isOwner: boolean
  readOnly: boolean
  showResolved: boolean
  openId: string | null
  onOpen(id: string | null): void
  draft: CommentDraft | null
  onCancelDraft(): void
  onCreate(text: string): void
}

const PIN = 32
const POPOVER_WIDTH = 300

/** Where a popover goes next to a pin, kept inside the view. */
function popoverPlace(pin: { x: number; y: number }, size: { width: number; height: number }) {
  const right = pin.x + PIN + 12
  const left = right + POPOVER_WIDTH > size.width - 12 ? Math.max(12, pin.x - POPOVER_WIDTH - 12) : right
  const top = Math.min(Math.max(70, pin.y - PIN), Math.max(70, size.height - 320))
  return { left, top }
}

/** Comment pins on the board, the open thread, and the composer for a new one. */
export function CommentLayer(props: CommentLayerProps) {
  const { comments, threads, lookup, camera, size, me, isOwner, readOnly, showResolved, openId, onOpen, draft, onCancelDraft, onCreate } = props
  const open = threads.find((t) => t.id === openId) ?? null
  const screenOf = (thread: Thread) => toScreen(camera, pinPosition(thread, lookup))

  return (
    <div className="comment-layer">
      {threads.map((thread) => {
        if (thread.resolved && !showResolved && thread.id !== openId) return null
        const at = screenOf(thread)
        if (at.x < -PIN || at.y < 0 || at.x > size.width + PIN || at.y > size.height + PIN) return null
        const first = thread.messages[0]
        return (
          <button
            key={thread.id}
            type="button"
            className={`comment-pin${thread.resolved ? ' resolved' : ''}${thread.id === openId ? ' open' : ''}`}
            style={{ transform: `translate(${at.x}px, ${at.y - PIN}px)` }}
            aria-label={`Comment by ${thread.author.name}: ${first.text.slice(0, 80)}`}
            aria-expanded={thread.id === openId}
            onClick={() => onOpen(thread.id === openId ? null : thread.id)}
          >
            <span className="pin-avatar" style={{ background: thread.author.color }}>
              {initials(thread.author.name)}
            </span>
            {thread.messages.length > 1 && <span className="pin-count">{thread.messages.length}</span>}
          </button>
        )
      })}

      {draft && (
        <DraftComposer at={toScreen(camera, draft)} size={size} me={me} onCancel={onCancelDraft} onCreate={onCreate} />
      )}

      {open && !draft && (
        <ThreadPopover
          key={open.id}
          thread={open}
          place={popoverPlace(screenOf(open), size)}
          comments={comments}
          me={me}
          isOwner={isOwner}
          readOnly={readOnly}
          onClose={() => onOpen(null)}
        />
      )}
    </div>
  )
}

function DraftComposer(props: {
  at: { x: number; y: number }
  size: { width: number; height: number }
  me: CommentAuthor
  onCancel(): void
  onCreate(text: string): void
}) {
  const { at, size, me, onCancel, onCreate } = props
  const [text, setText] = useState('')
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (text.trim()) onCreate(text)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <>
      <span className="comment-pin draft" style={{ transform: `translate(${at.x}px, ${at.y - PIN}px)` }} aria-hidden>
        <span className="pin-avatar" style={{ background: me.color }}>
          {initials(me.name)}
        </span>
      </span>
      <form className="panel comment-popover" style={popoverPlace(at, size)} onSubmit={submit} aria-label="New comment">
        <textarea autoFocus aria-label="Comment" placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} rows={3} />
        <div className="composer-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!text.trim()}>
            Comment
          </button>
        </div>
      </form>
    </>
  )
}

function ThreadPopover(props: {
  thread: Thread
  place: { left: number; top: number }
  comments: Comments
  me: CommentAuthor
  isOwner: boolean
  readOnly: boolean
  onClose(): void
}) {
  const { thread, place, comments, me, isOwner, readOnly, onClose } = props
  const [reply, setReply] = useState('')
  const send = (e?: FormEvent) => {
    e?.preventDefault()
    if (!reply.trim()) return
    comments.reply(thread.id, me, reply)
    setReply('')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
  const canDelete = !readOnly && (thread.author.id === me.id || isOwner)

  return (
    <div className="panel comment-popover" style={place} role="dialog" aria-label="Comment thread">
      <header className="comment-header">
        <span className={thread.resolved ? 'resolved-label' : ''}>{thread.resolved ? 'Resolved' : 'Comment'}</span>
        {!readOnly && (
          <button
            type="button"
            className="icon-button"
            aria-label={thread.resolved ? 'Reopen' : 'Resolve'}
            title={thread.resolved ? 'Reopen' : 'Resolve'}
            onClick={() => {
              comments.setResolved(thread.id, !thread.resolved)
              if (!thread.resolved) onClose()
            }}
          >
            {thread.resolved ? <RotateCcw size={16} strokeWidth={1.75} /> : <CircleCheck size={18} strokeWidth={1.75} />}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="icon-button danger"
            aria-label="Delete thread"
            title="Delete thread"
            onClick={() => {
              comments.removeThread(thread.id)
              onClose()
            }}
          >
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
        )}
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <ol className="comment-messages" aria-label="Messages">
        {thread.messages.map((message, i) => (
          <li key={message.id}>
            <span className="avatar small" style={{ background: message.author.color }}>
              {initials(message.author.name)}
            </span>
            <div className="comment-body">
              <div className="comment-meta">
                <strong>{message.author.name}</strong>
                <span>{timeAgo(message.at)}</span>
              </div>
              <p>{message.text}</p>
            </div>
            {!readOnly && i > 0 && message.author.id === me.id && (
              <button type="button" className="icon-button tiny danger" aria-label="Delete reply" onClick={() => comments.removeMessage(thread.id, message.id)}>
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <form className="reply-form" onSubmit={send}>
          <textarea aria-label="Reply" placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={onKeyDown} rows={1} />
          <button type="submit" className="icon-button" aria-label="Send reply" disabled={!reply.trim()}>
            <Send size={16} strokeWidth={1.75} />
          </button>
        </form>
      )}
    </div>
  )
}
