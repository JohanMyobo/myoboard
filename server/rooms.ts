import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'

// Message types of the y-websocket protocol, which the browser client speaks.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const ROOM_NAME = /^[A-Za-z0-9_-]{1,64}$/
const PING_INTERVAL_MS = 30_000

/** Room names become file names, so only a safe alphabet is accepted. */
export const isValidRoomName = (name: string): boolean => ROOM_NAME.test(name)

export interface RoomManagerOptions {
  /** Where boards are saved; null keeps everything in memory. */
  dataDir: string | null
  /** Save this long after the last edit... */
  saveDelayMs?: number
  /** ...but never later than this after the first unsaved edit. */
  maxSaveDelayMs?: number
  /** Called when a board's title changes (and when a board with a title opens). */
  onTitle?(board: string, title: string): void
  /** A title to give a board that has none yet (one chosen when it was created). */
  initialTitle?(board: string): string | undefined
  /** Called after a board is saved, with the time of its last edit. */
  onSaved?(board: string, editedAt: number): void
}

/** Who is on the other end of a connection, and whether they may edit. */
export interface Participant {
  userId: string
  readOnly: boolean
}

/** Close code that tells the client its access changed: it reconnects and asks again. */
export const ACCESS_CHANGED = 4000

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

interface Connection extends Participant {
  /** Awareness client ids this connection controls. */
  controlled: Set<number>
}

/** One board: its document, who is connected, and their presence. */
class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  readonly conns = new Map<WebSocket, Connection>()

  private saveTimer: NodeJS.Timeout | null = null
  private firstUnsavedAt = 0
  private lastEditAt = 0
  private dirty = false
  private closed = false

  constructor(
    private readonly name: string,
    private readonly file: string | null,
    private readonly saveDelayMs: number,
    private readonly maxSaveDelayMs: number,
    private readonly hooks: Pick<RoomManagerOptions, 'onTitle' | 'onSaved' | 'initialTitle'>,
  ) {
    if (file && fs.existsSync(file)) Y.applyUpdate(this.doc, fs.readFileSync(file))
    this.awareness.setLocalState(null) // the server has no cursor of its own
    this.doc.on('update', this.handleUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
    const meta = this.doc.getMap('meta')
    const reportTitle = () => {
      const title = meta.get('title')
      // Runs inside Yjs transactions: a failure here must not reject the update.
      try {
        if (typeof title === 'string') this.hooks.onTitle?.(this.name, title)
      } catch (err) {
        console.error(`[sync] could not record the title of ${this.name}:`, err)
      }
    }
    meta.observe(reportTitle)
    if (typeof meta.get('title') !== 'string') {
      const initial = this.hooks.initialTitle?.(this.name)
      if (initial) meta.set('title', initial)
    }
    reportTitle()
  }

  get persistent(): boolean {
    return this.file !== null
  }

  join(conn: WebSocket, participant: Participant): void {
    this.conns.set(conn, { ...participant, controlled: new Set() })
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
    const controlled = this.conns.get(conn)?.controlled
    this.conns.delete(conn)
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...controlled], null)
    }
  }

  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.firstUnsavedAt = 0
    if (!this.file || !this.dirty) return
    this.dirty = false
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, Y.encodeStateAsUpdate(this.doc))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      // A failed write (disk full, data folder removed, file briefly locked by
      // an antivirus on Windows) must not take the server down: keep the edits
      // and try again. A closed room gives up; its clients still hold the edits.
      console.error(`[sync] could not save ${this.file}:`, err)
      if (!this.closed) this.scheduleSave()
      return
    }
    try {
      this.hooks.onSaved?.(this.name, this.lastEditAt)
    } catch (err) {
      console.error(`[sync] could not record when ${this.name} was saved:`, err)
    }
  }

  destroy(): void {
    this.closed = true
    this.save()
    this.awareness.destroy()
    this.doc.destroy()
  }

  /** Drops the board without saving it (it was deleted). */
  discard(): void {
    this.closed = true
    this.dirty = false
    if (this.saveTimer) clearTimeout(this.saveTimer)
    for (const conn of this.conns.keys()) conn.close(ACCESS_CHANGED, 'board deleted')
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
        const step = decoding.readVarUint(decoder)
        if (step === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, reply, this.doc)
        } else if (step === syncProtocol.messageYjsSyncStep2 || step === syncProtocol.messageYjsUpdate) {
          // Viewers get every change but their own edits never reach the board.
          if (!this.conns.get(conn)?.readOnly) syncProtocol.readSyncStep2(decoder, this.doc, conn)
        } else {
          throw new Error(`unknown sync message ${step}`)
        }
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
    const controlled = origin instanceof WebSocket ? this.conns.get(origin)?.controlled : undefined
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
    if (!this.file || this.closed) return
    this.dirty = true
    const now = Date.now()
    this.lastEditAt = now
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
  private readonly saveDelayMs: number
  private readonly maxSaveDelayMs: number

  constructor(private readonly options: RoomManagerOptions) {
    this.saveDelayMs = options.saveDelayMs ?? 1_000
    this.maxSaveDelayMs = options.maxSaveDelayMs ?? 5_000
    if (options.dataDir) fs.mkdirSync(options.dataDir, { recursive: true })
  }

  get openRooms(): number {
    return this.rooms.size
  }

  /** Where a board is saved, or null when boards live in memory. */
  fileFor(name: string): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, `${name}.ybin`) : null
  }

  connect(conn: WebSocket, name: string, participant: Participant): void {
    if (!isValidRoomName(name)) {
      conn.close(1008, 'invalid board id')
      return
    }
    let room = this.rooms.get(name)
    if (!room) {
      room = new Room(name, this.fileFor(name), this.saveDelayMs, this.maxSaveDelayMs, this.options)
      this.rooms.set(name, room)
    }
    room.join(conn, participant)

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
        joined.destroy()
      }
    })
  }

  /**
   * Re-checks everyone on a board after its permissions changed. Whoever lost
   * access, or went from editor to viewer or back, is disconnected with
   * ACCESS_CHANGED; their client reconnects and picks up its new role.
   */
  refreshAccess(name: string, readOnlyFor: (userId: string) => boolean | null): void {
    const room = this.rooms.get(name)
    if (!room) return
    for (const [conn, info] of room.conns) {
      const readOnly = readOnlyFor(info.userId)
      if (readOnly !== info.readOnly) conn.close(ACCESS_CHANGED, 'access changed')
    }
  }

  /** Disconnects everyone and forgets a deleted board without saving it. */
  discard(name: string): void {
    const room = this.rooms.get(name)
    if (!room) return
    this.rooms.delete(name)
    room.discard()
  }

  /** Writes every open board to disk now (used on shutdown). */
  flushAll(): void {
    for (const room of this.rooms.values()) room.save()
  }
}
