import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { toScreen } from '../canvas/camera'
import type { Camera } from '../canvas/camera'
import { objectBounds } from '../model/geometry'
import { tally } from '../model/facilitation'
import type { Facilitation, Facilitator, FacilitationSnapshot } from '../model/facilitation'
import type { BoardObject } from '../model/types'
import { serverNow } from '../sync/clock'

/** What people can vote on: things with content, not lines or frames. */
export const VOTABLE: ReadonlySet<BoardObject['type']> = new Set(['sticky', 'shape', 'text', 'image'])

interface VoteMenuProps {
  facilitation: Facilitation
  state: FacilitationSnapshot
  me: Facilitator
  readOnly: boolean
}

/** Behind the top bar's vote button: start a vote, end it, clear the results. */
export function VoteMenu({ facilitation, state, me, readOnly, onDone }: VoteMenuProps & { onDone(): void }) {
  const [votes, setVotes] = useState(3)
  const { vote, ballots } = state
  if (vote?.status === 'running') {
    const voters = [...ballots.values()].filter((b) => b.length > 0).length
    return (
      <div className="vote-menu">
        <span className="menu-title">Voting in progress</span>
        <p className="muted">
          {voters === 1 ? '1 person has voted' : `${voters} people have voted`}, {vote.votesPerPerson} votes each.
        </p>
        {!readOnly && (
          <button
            type="button"
            className="primary-button wide"
            onClick={() => {
              facilitation.endVote()
              onDone()
            }}
          >
            End the vote and show results
          </button>
        )}
      </div>
    )
  }
  if (vote?.status === 'ended') {
    return (
      <div className="vote-menu">
        <span className="menu-title">Results are on the board</span>
        {!readOnly && (
          <button
            type="button"
            className="secondary-button wide"
            onClick={() => {
              facilitation.clearVote()
              onDone()
            }}
          >
            Clear the results
          </button>
        )}
      </div>
    )
  }
  if (readOnly) return <p className="muted vote-menu">No vote running.</p>
  return (
    <div className="vote-menu">
      <span className="menu-title">Start a vote</span>
      <p className="muted">Everyone clicks the notes they prefer. Nobody sees the counts until you end the vote.</p>
      <div className="stepper" role="group" aria-label="Votes per person">
        <button type="button" className="icon-button" aria-label="Fewer votes" onClick={() => setVotes((v) => Math.max(1, v - 1))}>
          <Minus size={16} strokeWidth={2} />
        </button>
        <span>
          <strong>{votes}</strong> {votes === 1 ? 'vote' : 'votes'} per person
        </span>
        <button type="button" className="icon-button" aria-label="More votes" onClick={() => setVotes((v) => Math.min(10, v + 1))}>
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>
      <button
        type="button"
        className="primary-button wide"
        onClick={() => {
          facilitation.startVote(votes, me, serverNow())
          onDone()
        }}
      >
        Start voting
      </button>
    </div>
  )
}

interface VoteBannerProps {
  facilitation: Facilitation
  state: FacilitationSnapshot
  me: Facilitator
  readOnly: boolean
  lookup(id: string): BoardObject | undefined
  onShow(id: string): void
}

const excerpt = (obj: BoardObject | undefined) => {
  if (!obj) return 'Deleted'
  if ('text' in obj && obj.text.trim()) return obj.text.trim().slice(0, 40)
  if (obj.type === 'image') return obj.name ?? 'Image'
  return 'Untitled'
}

/** Under the top bar during a vote: votes left, then the results. */
export function VoteBanner({ facilitation, state, me, readOnly, lookup, onShow }: VoteBannerProps) {
  const { vote, ballots } = state
  if (!vote) return null
  if (vote.status === 'running') {
    const used = ballots.get(me.id)?.length ?? 0
    const left = vote.votesPerPerson - used
    return (
      <div className="panel vote-banner" role="status" aria-label="Voting">
        <span className="vote-dot" aria-hidden />
        <span>
          {readOnly ? (
            'A vote is in progress.'
          ) : (
            <>
              <strong>{left}</strong> of {vote.votesPerPerson} votes left. Click notes to vote, Shift-click to take a vote back.
            </>
          )}
        </span>
        {!readOnly && (
          <button type="button" className="secondary-button" onClick={() => facilitation.endVote()}>
            End vote
          </button>
        )}
      </div>
    )
  }
  const ranked = [...tally(ballots)].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((sum, [, n]) => sum + n, 0)
  return (
    <div className="panel vote-banner results" role="status" aria-label="Vote results">
      <div className="vote-results-head">
        <strong>Vote results</strong>
        <span className="muted">{total === 1 ? '1 vote' : `${total} votes`}</span>
        {!readOnly && (
          <button type="button" className="secondary-button" onClick={() => facilitation.clearVote()}>
            Clear
          </button>
        )}
      </div>
      {ranked.length > 0 && (
        <ol className="vote-ranking">
          {ranked.slice(0, 5).map(([id, count]) => (
            <li key={id}>
              <button type="button" onClick={() => onShow(id)}>
                <span className="vote-count">{count}</span>
                <span className="vote-label">{excerpt(lookup(id))}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

interface VoteBadgesProps {
  state: FacilitationSnapshot
  me: Facilitator & { color: string }
  lookup(id: string): BoardObject | undefined
  camera: Camera
}

/** Dots on what you voted for while voting; everyone's totals once the vote ends. */
export function VoteBadges({ state, me, lookup, camera }: VoteBadgesProps) {
  const { vote, ballots } = state
  if (!vote) return null
  const counts = vote.status === 'running' ? tally(new Map([[me.id, ballots.get(me.id) ?? []]])) : tally(ballots)
  const top = Math.max(0, ...counts.values())
  return (
    <div className="vote-badges" aria-hidden>
      {[...counts].map(([id, count]) => {
        const obj = lookup(id)
        const box = obj ? objectBounds(obj) : null
        if (!box || count === 0) return null
        // Top-left: comment pins usually sit on the top-right corner.
        const at = toScreen(camera, { x: box.x, y: box.y })
        return (
          <span
            key={id}
            className={`vote-badge${vote.status === 'ended' && count === top ? ' top' : ''}`}
            style={{ transform: `translate(${at.x - 14}px, ${at.y - 10}px)`, background: vote.status === 'running' ? me.color : undefined }}
          >
            {count}
          </span>
        )
      })}
    </div>
  )
}
