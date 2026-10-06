import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, StickyNote, Trash2 } from 'lucide-react'
import { ROLE_LABEL, api } from '../api'
import type { BoardListing, User } from '../api'
import { STICKY_COLORS } from '../model/palette'
import { navigate } from '../router'
import { Brand } from '../ui/Brand'
import { Modal } from '../ui/Modal'
import { UserMenu } from '../ui/UserMenu'
import { timeAgo } from '../ui/time'

type Filter = 'all' | 'owned' | 'shared'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned by me' },
  { value: 'shared', label: 'Shared with me' },
]

function tint(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return STICKY_COLORS[hash % STICKY_COLORS.length].value
}

/** "My boards": everything you own, were invited to or opened, most recent first. */
export function HomeScreen({ user, onSignOut }: { user: User; onSignOut(): void }) {
  const [boards, setBoards] = useState<BoardListing[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [doomed, setDoomed] = useState<BoardListing | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api
      .boards()
      .then(({ boards: list }) => setBoards(list))
      .catch((err: Error) => setProblem(err.message))
  }, [])
  useEffect(load, [load])

  const create = async () => {
    setBusy(true)
    try {
      const { board } = await api.createBoard()
      navigate(`/b/${board.id}`)
    } catch (err) {
      setProblem((err as Error).message)
      setBusy(false)
    }
  }

  const remove = async (board: BoardListing) => {
    setDoomed(null)
    try {
      await api.deleteBoard(board.id)
      setBoards((list) => list?.filter((b) => b.id !== board.id) ?? null)
    } catch (err) {
      setProblem((err as Error).message)
    }
  }

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    return (boards ?? []).filter((b) => {
      if (filter === 'owned' && b.role !== 'owner') return false
      if (filter === 'shared' && b.role === 'owner') return false
      return !words || (b.title || 'Untitled board').toLowerCase().includes(words) || b.ownerName.toLowerCase().includes(words)
    })
  }, [boards, filter, query])

  return (
    <div className="home">
      <header className="home-header">
        <Brand />
        <UserMenu user={user} onSignOut={onSignOut} />
      </header>
      <main className="home-main">
        <div className="home-title-row">
          <h1>Boards</h1>
          <button type="button" className="primary-button" onClick={create} disabled={busy}>
            <Plus size={16} strokeWidth={2} />
            New board
          </button>
        </div>

        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}

        <div className="home-toolbar">
          <div className="segmented tabs" role="tablist" aria-label="Show">
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={16} strokeWidth={1.75} />
            <input type="search" placeholder="Search boards" aria-label="Search boards" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>

        {boards === null ? (
          <p className="muted">Loading your boards…</p>
        ) : shown.length === 0 ? (
          <div className="home-empty">
            {boards.length === 0 ? (
              <>
                <p>No boards yet.</p>
                <p className="muted">Create one, or open a link someone shared with you.</p>
              </>
            ) : (
              <p className="muted">No board matches.</p>
            )}
          </div>
        ) : (
          <ul className="board-list" aria-label="Boards">
            {shown.map((board) => {
              const title = board.title || 'Untitled board'
              return (
                <li key={board.id} className="board-row">
                  <a
                    className="board-link"
                    href={`/b/${board.id}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                      e.preventDefault()
                      navigate(`/b/${board.id}`)
                    }}
                  >
                    <span className="board-thumb" style={{ background: tint(board.id) }} aria-hidden>
                      <StickyNote size={18} strokeWidth={1.75} />
                    </span>
                    <span className="board-name">{title}</span>
                  </a>
                  <span className="board-owner">{board.ownerId === user.id ? 'You' : board.ownerName}</span>
                  <span className={`role-badge ${board.role}`}>{ROLE_LABEL[board.role]}</span>
                  <span className="board-when">
                    {board.lastOpenedAt ? `Opened ${timeAgo(board.lastOpenedAt)}` : `Edited ${timeAgo(board.updatedAt)}`}
                  </span>
                  {board.role === 'owner' ? (
                    <button type="button" className="icon-button danger" aria-label={`Delete ${title}`} title="Delete" onClick={() => setDoomed(board)}>
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span className="icon-spacer" />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {doomed && (
        <Modal
          title="Delete this board?"
          onClose={() => setDoomed(null)}
          width={420}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setDoomed(null)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={() => remove(doomed)}>
                Delete board
              </button>
            </>
          }
        >
          <p>
            “{doomed.title || 'Untitled board'}” and everything on it will be deleted for everyone. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}
