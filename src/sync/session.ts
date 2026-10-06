import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { Awareness } from 'y-protocols/awareness'
import { Board } from '../model/board'
import { Comments } from '../model/comments'
import { Facilitation } from '../model/facilitation'
import type { Identity } from './identity'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** What each person shares with the others while on a board. */
export interface PresenceState {
  user: Identity
  /** Pointer position in board coordinates, or null when off the canvas. */
  cursor: { x: number; y: number } | null
  selection: string[]
}

/** Everything needed to work on one board: the document and how it syncs. */
export interface BoardSession {
  readonly boardId: string
  readonly doc: Y.Doc
  readonly board: Board
  readonly comments: Comments
  /** The shared timer and voting sessions. */
  readonly facilitation: Facilitation
  readonly provider: WebsocketProvider
  readonly awareness: Awareness
  /** Local copy in IndexedDB: the board opens instantly and survives going offline. */
  readonly offline: IndexeddbPersistence
  destroy(): void
}

const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Close code the server uses when your access to the board changed: ask again what you may do. */
export const ACCESS_CHANGED = 4000

export const isValidBoardId = (id: string): boolean => BOARD_ID.test(id)

export function syncServerUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export function openBoardSession(boardId: string, identity: Identity): BoardSession {
  const doc = new Y.Doc()
  const board = new Board(doc)
  const comments = new Comments(doc)
  const facilitation = new Facilitation(doc)
  const offline = new IndexeddbPersistence(`myoboard:${boardId}`, doc)
  const provider = new WebsocketProvider(syncServerUrl(), boardId, doc, { maxBackoffTime: 4000 })
  const awareness = provider.awareness
  const presence: PresenceState = { user: identity, cursor: null, selection: [] }
  awareness.setLocalState(presence)

  return {
    boardId,
    doc,
    board,
    comments,
    facilitation,
    provider,
    awareness,
    offline,
    destroy() {
      awareness.setLocalState(null)
      provider.destroy()
      void offline.destroy()
      board.destroy()
      comments.destroy()
      facilitation.destroy()
      doc.destroy()
    },
  }
}
