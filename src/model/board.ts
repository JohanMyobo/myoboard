import * as Y from 'yjs'
import { generateNKeysBetween } from 'fractional-indexing'
import { nanoid } from 'nanoid'
import { isAttached } from './types'
import type { BoardObject, Endpoint, NewObject, ObjectPatch } from './types'

/** Transaction origin for edits made in this tab; only these can be undone here. */
export const LOCAL_ORIGIN = 'myoboard:local'

export interface BoardSnapshot {
  /** Bumped on every change, so React sees a new snapshot. */
  readonly version: number
  readonly byId: ReadonlyMap<string, BoardObject>
  /** Every object, back to front. */
  readonly ordered: readonly BoardObject[]
  readonly title: string
}

export const DEFAULT_TITLE = 'Untitled board'

function byIndex(a: BoardObject, b: BoardObject): number {
  if (a.index < b.index) return -1
  if (a.index > b.index) return 1
  // Two people can generate the same index at the same time; ids break the tie.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function readObject(id: string, ymap: Y.Map<unknown>): BoardObject | null {
  const data = ymap.toJSON() as Record<string, unknown>
  if (typeof data.type !== 'string' || typeof data.index !== 'string') return null
  return { ...data, id } as BoardObject
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

const refersTo = (endpoint: Endpoint, ids: ReadonlySet<string>) => isAttached(endpoint) && ids.has(endpoint.id)

/**
 * A board backed by a Yjs document: `objects` maps ids to property maps, and
 * `meta` holds board-level fields such as the title. Edits go through this
 * class so they are tagged as local and can be undone.
 */
export class Board {
  readonly doc: Y.Doc
  readonly objects: Y.Map<Y.Map<unknown>>
  readonly meta: Y.Map<unknown>
  readonly undoManager: Y.UndoManager

  private readonly byId = new Map<string, BoardObject>()
  private snapshot: BoardSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc
    this.objects = doc.getMap('objects')
    this.meta = doc.getMap('meta')
    this.undoManager = new Y.UndoManager([this.objects, this.meta], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 500,
    })
    this.objects.forEach((ymap, id) => {
      const obj = readObject(id, ymap)
      if (obj) this.byId.set(id, obj)
    })
    this.snapshot = this.buildSnapshot(0, true)
    this.objects.observeDeep(this.handleObjectsChange)
    this.meta.observe(this.handleMetaChange)
  }

  // --- Reading -------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): BoardSnapshot => this.snapshot

  get(id: string): BoardObject | undefined {
    return this.byId.get(id)
  }

  // --- Writing -------------------------------------------------------------

  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL_ORIGIN)
  }

  create(input: NewObject): string {
    return this.createMany([input])[0]
  }

  /** Creates objects on top of everything else, in the given order. */
  createMany(inputs: readonly NewObject[]): string[] {
    if (inputs.length === 0) return []
    const ids = inputs.map(() => nanoid(12))
    const indexes = generateNKeysBetween(this.lastIndex(), null, inputs.length)
    this.transact(() => {
      inputs.forEach((input, i) => {
        const ymap = new Y.Map<unknown>()
        for (const [key, value] of Object.entries({ ...input, id: ids[i], index: indexes[i] })) {
          if (value !== undefined) ymap.set(key, value)
        }
        this.objects.set(ids[i], ymap)
      })
    })
    return ids
  }

  update(id: string, patch: ObjectPatch): void {
    this.updateMany([{ id, patch }])
  }

  /** Applies several patches as one change (one undo step, one sync message). */
  updateMany(patches: readonly { id: string; patch: ObjectPatch }[]): void {
    this.transact(() => {
      for (const { id, patch } of patches) {
        const ymap = this.objects.get(id)
        if (!ymap) continue
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'id' || key === 'type' || value === undefined) continue
          if (!sameValue(ymap.get(key), value)) ymap.set(key, value)
        }
      }
    })
  }

  /** Deletes objects, along with any connector attached to one of them. */
  remove(ids: Iterable<string>): void {
    const doomed = new Set(ids)
    for (const obj of this.byId.values()) {
      if (obj.type === 'connector' && (refersTo(obj.from, doomed) || refersTo(obj.to, doomed))) doomed.add(obj.id)
    }
    this.transact(() => {
      for (const id of doomed) this.objects.delete(id)
    })
  }

  /** Copies objects (keeping their stacking order), offset by `offset`. Returns the new ids. */
  duplicate(ids: Iterable<string>, offset = 24): string[] {
    const wanted = new Set(ids)
    const originals = this.snapshot.ordered.filter((obj) => wanted.has(obj.id))
    const copies = originals.map((obj) => {
      const { id, index, ...rest } = obj
      void id
      void index
      return this.offsetCopy(rest as NewObject, offset)
    })
    const created = this.createMany(copies)
    const newIds = new Map(originals.map((obj, i) => [obj.id, created[i]]))
    // Copied connectors follow copied objects; ends attached elsewhere stay put.
    const remap = (endpoint: Endpoint): Endpoint => {
      if (!isAttached(endpoint)) return endpoint
      const mapped = newIds.get(endpoint.id)
      return mapped ? { id: mapped } : endpoint
    }
    const fixes = originals.flatMap((obj, i) =>
      obj.type === 'connector' ? [{ id: created[i], patch: { from: remap(obj.from), to: remap(obj.to) } }] : [],
    )
    if (fixes.length > 0) this.updateMany(fixes)
    return created
  }

  bringToFront(ids: Iterable<string>): void {
    const wanted = new Set(ids)
    const moving = this.snapshot.ordered.filter((obj) => wanted.has(obj.id))
    if (moving.length === 0) return
    const indexes = generateNKeysBetween(this.lastIndex(), null, moving.length)
    this.updateMany(moving.map((obj, i) => ({ id: obj.id, patch: { index: indexes[i] } })))
  }

  setTitle(title: string): void {
    this.transact(() => this.meta.set('title', title))
  }

  // --- History -------------------------------------------------------------

  undo(): void {
    this.undoManager.undo()
  }

  redo(): void {
    this.undoManager.redo()
  }

  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0
  }

  /** Ends the current undo step, so the next edit starts a new one. */
  checkpoint(): void {
    this.undoManager.stopCapturing()
  }

  destroy(): void {
    this.objects.unobserveDeep(this.handleObjectsChange)
    this.meta.unobserve(this.handleMetaChange)
    this.undoManager.destroy()
    this.listeners.clear()
  }

  // --- Internals -----------------------------------------------------------

  private lastIndex(): string | null {
    let last: string | null = null
    for (const obj of this.byId.values()) {
      if (last === null || obj.index > last) last = obj.index
    }
    return last
  }

  private offsetCopy(obj: NewObject, offset: number): NewObject {
    if (obj.type !== 'connector') return { ...obj, x: obj.x + offset, y: obj.y + offset }
    const shift = (endpoint: Endpoint): Endpoint =>
      isAttached(endpoint) ? endpoint : { x: endpoint.x + offset, y: endpoint.y + offset }
    return { ...obj, from: shift(obj.from), to: shift(obj.to) }
  }

  private readonly handleObjectsChange = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    let orderChanged = false
    for (const event of events) {
      if (event.target === this.objects) {
        for (const id of (event as Y.YMapEvent<unknown>).keysChanged) {
          this.refresh(id)
          orderChanged = true
        }
      } else {
        const id = event.path[0]
        if (typeof id !== 'string') continue
        this.refresh(id)
        if ((event as Y.YMapEvent<unknown>).keysChanged.has('index')) orderChanged = true
      }
    }
    this.publish(orderChanged)
  }

  private readonly handleMetaChange = (): void => {
    this.publish(false)
  }

  private refresh(id: string): void {
    const ymap = this.objects.get(id)
    const obj = ymap ? readObject(id, ymap) : null
    if (obj) this.byId.set(id, obj)
    else this.byId.delete(id)
  }

  private publish(orderChanged: boolean): void {
    this.snapshot = this.buildSnapshot(this.snapshot.version + 1, orderChanged)
    for (const listener of this.listeners) listener()
  }

  private buildSnapshot(version: number, orderChanged: boolean): BoardSnapshot {
    const ordered =
      orderChanged || !this.snapshot
        ? [...this.byId.values()].sort(byIndex)
        : this.snapshot.ordered.flatMap((obj) => {
            const current = this.byId.get(obj.id)
            return current ? [current] : []
          })
    const title = this.meta.get('title')
    return {
      version,
      byId: new Map(this.byId),
      ordered,
      title: typeof title === 'string' && title.trim() ? title : DEFAULT_TITLE,
    }
  }
}
