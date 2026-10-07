import * as Y from 'yjs'
import { nanoid } from 'nanoid'

/**
 * The shared timer and voting sessions of a workshop, in the board's Yjs
 * document (map `facilitation`). Times are on the server's clock (see
 * `sync/clock.ts`), so everyone sees the same countdown.
 */

export interface Facilitator {
  id: string
  name: string
}

export interface TimerState {
  status: 'running' | 'paused'
  /** What it was set to, in ms. */
  duration: number
  /** When it reaches zero (running). */
  endsAt: number
  /** What is left (paused). */
  remaining: number
  startedBy: Facilitator
}

export interface VoteSession {
  id: string
  status: 'running' | 'ended'
  votesPerPerson: number
  startedBy: Facilitator
  startedAt: number
}

export interface FacilitationSnapshot {
  readonly version: number
  readonly timer: TimerState | null
  readonly vote: VoteSession | null
  /** Each person's votes in the current session: user id → object ids (one per vote). */
  readonly ballots: ReadonlyMap<string, readonly string[]>
}

const ORIGIN = 'myoboard:facilitation'
const BALLOT = 'ballot:'

/** Milliseconds left on a timer at `now`. */
export function timeLeft(timer: TimerState, now: number): number {
  return timer.status === 'paused' ? timer.remaining : Math.max(0, timer.endsAt - now)
}

/** Votes per object in the current session. */
export function tally(ballots: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const votes of ballots.values()) for (const id of votes) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

export class Facilitation {
  readonly map: Y.Map<unknown>
  private snapshot: FacilitationSnapshot = { version: 0, timer: null, vote: null, ballots: new Map() }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly doc: Y.Doc) {
    this.map = doc.getMap('facilitation')
    this.snapshot = this.build(0)
    this.map.observe(this.handleChange)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): FacilitationSnapshot => this.snapshot

  // --- Timer ---------------------------------------------------------------

  startTimer(duration: number, by: Facilitator, now: number): void {
    const timer: TimerState = { status: 'running', duration, endsAt: now + duration, remaining: duration, startedBy: by }
    this.set('timer', timer)
  }

  pauseTimer(now: number): void {
    const timer = this.snapshot.timer
    if (timer?.status !== 'running') return
    this.set('timer', { ...timer, status: 'paused', remaining: timeLeft(timer, now) })
  }

  resumeTimer(now: number): void {
    const timer = this.snapshot.timer
    if (timer?.status !== 'paused') return
    this.set('timer', { ...timer, status: 'running', endsAt: now + timer.remaining })
  }

  /** Adds time; a timer that ran out starts again with it. */
  addTime(ms: number, now: number): void {
    const timer = this.snapshot.timer
    if (!timer) return
    if (timer.status === 'paused') this.set('timer', { ...timer, remaining: timer.remaining + ms, duration: timer.duration + ms })
    else this.set('timer', { ...timer, endsAt: Math.max(timer.endsAt, now) + ms, duration: timer.duration + ms })
  }

  stopTimer(): void {
    this.doc.transact(() => this.map.delete('timer'), ORIGIN)
  }

  // --- Voting --------------------------------------------------------------

  startVote(votesPerPerson: number, by: Facilitator, now: number): void {
    this.doc.transact(() => {
      this.clearBallots()
      const session: VoteSession = { id: nanoid(8), status: 'running', votesPerPerson, startedBy: by, startedAt: now }
      this.map.set('vote', session)
    }, ORIGIN)
  }

  /** Adds one of `userId`'s votes to an object, if they have any left. */
  castVote(userId: string, objectId: string): boolean {
    const vote = this.snapshot.vote
    if (vote?.status !== 'running') return false
    const mine = this.snapshot.ballots.get(userId) ?? []
    if (mine.length >= vote.votesPerPerson) return false
    this.set(`${BALLOT}${vote.id}:${userId}`, [...mine, objectId])
    return true
  }

  /** Takes back one of `userId`'s votes on an object. */
  retractVote(userId: string, objectId: string): void {
    const vote = this.snapshot.vote
    if (vote?.status !== 'running') return
    const mine = [...(this.snapshot.ballots.get(userId) ?? [])]
    const index = mine.lastIndexOf(objectId)
    if (index < 0) return
    mine.splice(index, 1)
    this.set(`${BALLOT}${vote.id}:${userId}`, mine)
  }

  endVote(): void {
    const vote = this.snapshot.vote
    if (vote?.status === 'running') this.set('vote', { ...vote, status: 'ended' })
  }

  clearVote(): void {
    this.doc.transact(() => {
      this.map.delete('vote')
      this.clearBallots()
    }, ORIGIN)
  }

  destroy(): void {
    this.map.unobserve(this.handleChange)
    this.listeners.clear()
  }

  private clearBallots(): void {
    for (const key of [...this.map.keys()]) if (key.startsWith(BALLOT)) this.map.delete(key)
  }

  private set(key: string, value: unknown): void {
    this.doc.transact(() => this.map.set(key, value), ORIGIN)
  }

  private readonly handleChange = (): void => {
    this.snapshot = this.build(this.snapshot.version + 1)
    for (const listener of this.listeners) listener()
  }

  private build(version: number): FacilitationSnapshot {
    const timer = (this.map.get('timer') as TimerState | undefined) ?? null
    const vote = (this.map.get('vote') as VoteSession | undefined) ?? null
    const ballots = new Map<string, readonly string[]>()
    if (vote) {
      const prefix = `${BALLOT}${vote.id}:`
      this.map.forEach((value, key) => {
        if (key.startsWith(prefix) && Array.isArray(value)) ballots.set(key.slice(prefix.length), value.filter((v): v is string => typeof v === 'string'))
      })
    }
    return { version, timer, vote, ballots }
  }
}
