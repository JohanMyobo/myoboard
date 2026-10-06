import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import type { BoardObject } from './types'

/**
 * Comment threads on a board, kept in the board's Yjs document (map
 * `comments`) so everyone sees them live. They are not part of undo: undo
 * is for the board's content.
 */

export interface CommentAuthor {
  id: string
  name: string
  color: string
}

export interface CommentMessage {
  id: string
  author: CommentAuthor
  text: string
  at: number
}

export interface Thread {
  id: string
  /** Where the pin was put, on the board. */
  x: number
  y: number
  /** The object it is pinned to, if any: the pin follows it. */
  on: string | null
  /** Offset from that object's position. */
  dx: number
  dy: number
  resolved: boolean
  createdAt: number
  author: CommentAuthor
  messages: CommentMessage[]
}

export interface CommentsSnapshot {
  readonly version: number
  /** Oldest first. */
  readonly threads: readonly Thread[]
}

/** Origin of comment edits: Yjs undo ignores it. */
const COMMENTS_ORIGIN = 'myoboard:comments'

function readThread(id: string, ymap: Y.Map<unknown>): Thread | null {
  const messages = ymap.get('messages')
  const author = ymap.get('author') as CommentAuthor | undefined
  if (!(messages instanceof Y.Array) || !author) return null
  const num = (key: string) => {
    const value = ymap.get(key)
    return typeof value === 'number' ? value : 0
  }
  const on = ymap.get('on')
  return {
    id,
    x: num('x'),
    y: num('y'),
    on: typeof on === 'string' ? on : null,
    dx: num('dx'),
    dy: num('dy'),
    resolved: ymap.get('resolved') === true,
    createdAt: num('createdAt'),
    author,
    messages: (messages.toArray() as CommentMessage[]).filter((m) => m && typeof m.text === 'string'),
  }
}

/** Where a thread's pin is now: on its object if it still exists, else where it was put. */
export function pinPosition(thread: Thread, lookup: (id: string) => BoardObject | undefined): { x: number; y: number } {
  const target = thread.on ? lookup(thread.on) : undefined
  return target ? { x: target.x + thread.dx, y: target.y + thread.dy } : { x: thread.x, y: thread.y }
}

export class Comments {
  readonly map: Y.Map<Y.Map<unknown>>
  private snapshot: CommentsSnapshot = { version: 0, threads: [] }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly doc: Y.Doc) {
    this.map = doc.getMap('comments')
    this.snapshot = this.build(0)
    this.map.observeDeep(this.handleChange)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): CommentsSnapshot => this.snapshot

  /** Opens a thread with its first message; returns its id. */
  start(at: { x: number; y: number; on?: BoardObject | null }, author: CommentAuthor, text: string): string {
    const id = nanoid(12)
    this.doc.transact(() => {
      const thread = new Y.Map<unknown>()
      const messages = new Y.Array<CommentMessage>()
      messages.push([{ id: nanoid(10), author, text: text.trim(), at: Date.now() }])
      thread.set('x', Math.round(at.x))
      thread.set('y', Math.round(at.y))
      if (at.on) {
        thread.set('on', at.on.id)
        thread.set('dx', Math.round(at.x - at.on.x))
        thread.set('dy', Math.round(at.y - at.on.y))
      }
      thread.set('resolved', false)
      thread.set('createdAt', Date.now())
      thread.set('author', author)
      thread.set('messages', messages)
      this.map.set(id, thread)
    }, COMMENTS_ORIGIN)
    return id
  }

  reply(threadId: string, author: CommentAuthor, text: string): void {
    const messages = this.map.get(threadId)?.get('messages')
    if (!(messages instanceof Y.Array) || !text.trim()) return
    this.doc.transact(() => messages.push([{ id: nanoid(10), author, text: text.trim(), at: Date.now() }]), COMMENTS_ORIGIN)
  }

  setResolved(threadId: string, resolved: boolean): void {
    const thread = this.map.get(threadId)
    if (thread) this.doc.transact(() => thread.set('resolved', resolved), COMMENTS_ORIGIN)
  }

  /** Removes one message; removing the first one removes the whole thread. */
  removeMessage(threadId: string, messageId: string): void {
    const messages = this.map.get(threadId)?.get('messages')
    if (!(messages instanceof Y.Array)) return
    const index = (messages.toArray() as CommentMessage[]).findIndex((m) => m.id === messageId)
    if (index < 0) return
    this.doc.transact(() => {
      if (index === 0) this.map.delete(threadId)
      else messages.delete(index, 1)
    }, COMMENTS_ORIGIN)
  }

  removeThread(threadId: string): void {
    this.doc.transact(() => this.map.delete(threadId), COMMENTS_ORIGIN)
  }

  destroy(): void {
    this.map.unobserveDeep(this.handleChange)
    this.listeners.clear()
  }

  private readonly handleChange = (): void => {
    this.snapshot = this.build(this.snapshot.version + 1)
    for (const listener of this.listeners) listener()
  }

  private build(version: number): CommentsSnapshot {
    const threads: Thread[] = []
    this.map.forEach((ymap, id) => {
      const thread = readThread(id, ymap)
      if (thread && thread.messages.length > 0) threads.push(thread)
    })
    threads.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    return { version, threads }
  }
}
