import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'
import { FileStore } from './store'
import type { BoardStore } from './store'

// Message types of the y-websocket protocol, which the browser client speaks.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/
const PING_INTERVAL_MS = 30_000

/** Room names become file names, so only a safe alphabet is accepted. */
export const isValidRoomName = (name: string): boolean => ROOM_NAME.test(name)

export interface RoomManagerOptions {
  /** Where boards are saved; null keeps everything in memory. */
  dataDir?: string | null
  /** A board store to use instead of `dataDir` (e.g. cloud blobs when there's no local disk). */
  store?: BoardStore | null
  /** Save this long after the last edit... */
  saveDelayMs?: number
  /** ...but never later than this after the first unsaved edit. */
  maxSaveDelayMs?: number
}

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== WebSocket.OPEN) return
  conn.send(message, (err) => {
    if (err) conn.terminate()
  })
}

/** One board: its document, who is connected, and their presence. */
class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  /** Each connection, with the awareness client ids it controls. */
  readonly conns = new Map<WebSocket, Set<number>>()

  private saveTimer: NodeJS.Timeout | null = null
  private firstUnsavedAt = 0
  private dirty = false
  private closed = false
  /** Resolves once the board's saved bytes (if any) have been applied. */
  private readonly loaded: Promise<void>

  constructor(
    private readonly name: string,
    private readonly store: BoardStore | null,
    private readonly saveDelayMs: number,
    private readonly maxSaveDelayMs: number,
  ) {
    this.loaded = store
      ? store.load(name).then((data) => {
          if (data) Y.applyUpdate(this.doc, data)
        })
      : Promise.resolve()
    this.awareness.setLocalState(null) // the server has no cursor of its own
    this.doc.on('update', this.handleUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  get persistent(): boolean {
    return this.store !== null
  }

  async join(conn: WebSocket): Promise<void> {
    await this.loaded
    this.conns.set(conn, new Set())
    conn.on('message', (data) => this.handleMessage(conn, toBytes(data)))

    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    send(conn, encoding.toUint8Array(encoder))

    const states = this.awareness.getStates()
    if (states.size > 0) {
      const presence = encoding.createEncoder()
      encoding.writeVarUint(presence, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(presence, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]))
      send(conn, encoding.toUint8Array(presence))
    }
  }

  leave(conn: WebSocket): void {
    const controlled = this.conns.get(conn)
    this.conns.delete(conn)
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...controlled], null)
    }
  }

  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.firstUnsavedAt = 0
    if (!this.store || !this.dirty) return
    this.dirty = false
    // Snapshot the doc synchronously: it must not change (or be destroyed)
    // while the save below is in flight.
    const data = Y.encodeStateAsUpdate(this.doc)
    try {
      await this.store.save(this.name, data)
    } catch (err) {
      // A failed write (disk full, data folder removed, a blob store hiccup)
      // must not take the server down: keep the edits and try again. A
      // closed room gives up; its clients still hold the edits.
      console.error(`[sync] could not save board "${this.name}":`, err)
      this.dirty = true
      if (!this.closed) this.scheduleSave()
    }
  }

  async destroy(): Promise<void> {
    this.closed = true
    await this.save()
    this.awareness.destroy()
    this.doc.destroy()
  }

  private handleMessage(conn: WebSocket, message: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(message)
      const type = decoding.readVarUint(decoder)
      if (type === MESSAGE_SYNC) {
        const reply = encoding.createEncoder()
        encoding.writeVarUint(reply, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, reply, this.doc, conn)
        if (encoding.length(reply) > 1) send(conn, encoding.toUint8Array(reply))
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn)
      }
    } catch (err) {
      console.error('[sync] dropping a connection after a malformed message:', err)
      conn.close(1003, 'malformed message')
    }
  }

  private readonly handleUpdate = (update: Uint8Array, origin: unknown): void => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const message = encoding.toUint8Array(encoder)
    for (const conn of this.conns.keys()) {
      if (conn !== origin) send(conn, message)
    }
    this.scheduleSave()
  }

  private readonly handleAwarenessUpdate = ({ added, updated, removed }: AwarenessChange, origin: unknown): void => {
    const controlled = origin instanceof WebSocket ? this.conns.get(origin) : undefined
    if (controlled) {
      for (const id of added) controlled.add(id)
      for (const id of removed) controlled.delete(id)
    }
    const changed = [...added, ...updated, ...removed]
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
    const message = encoding.toUint8Array(encoder)
    for (const conn of this.conns.keys()) send(conn, message)
  }

  private scheduleSave(): void {
    if (!this.store) return
    this.dirty = true
    const now = Date.now()
    if (!this.firstUnsavedAt) this.firstUnsavedAt = now
    if (this.saveTimer) clearTimeout(this.saveTimer)
    const wait = Math.max(0, Math.min(this.saveDelayMs, this.firstUnsavedAt + this.maxSaveDelayMs - now))
    this.saveTimer = setTimeout(() => this.save(), wait)
  }
}

/**
 * Keeps one Room per board that has someone connected. A persisted room is
 * saved and dropped from memory when its last connection closes.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly store: BoardStore | null
  private readonly saveDelayMs: number
  private readonly maxSaveDelayMs: number

  constructor(options: RoomManagerOptions) {
    this.saveDelayMs = options.saveDelayMs ?? 1_000
    this.maxSaveDelayMs = options.maxSaveDelayMs ?? 5_000
    this.store = options.store ?? (options.dataDir ? new FileStore(options.dataDir) : null)
  }

  get openRooms(): number {
    return this.rooms.size
  }

  connect(conn: WebSocket, name: string): void {
    if (!isValidRoomName(name)) {
      conn.close(1008, 'invalid board id')
      return
    }
    let room = this.rooms.get(name)
    if (!room) {
      room = new Room(name, this.store, this.saveDelayMs, this.maxSaveDelayMs)
      this.rooms.set(name, room)
    }
    void room.join(conn)

    let alive = true
    conn.on('pong', () => {
      alive = true
    })
    const ping = setInterval(() => {
      if (!alive) {
        conn.terminate()
        return
      }
      alive = false
      conn.ping()
    }, PING_INTERVAL_MS)

    const joined = room
    conn.on('close', () => {
      clearInterval(ping)
      joined.leave(conn)
      if (joined.conns.size === 0 && joined.persistent && this.rooms.get(name) === joined) {
        this.rooms.delete(name)
        void joined.destroy()
      }
    })
  }

  /** Saves every open board now, and waits for it (used on shutdown). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((room) => room.save()))
  }
}
