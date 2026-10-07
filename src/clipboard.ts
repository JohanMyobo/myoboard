import type { BoardSnapshot } from './model/board'
import { connectorRoute, objectBounds, objectsInside, unionBoxes } from './model/geometry'
import type { Box, Point } from './model/geometry'
import { isAttached } from './model/types'
import type { BoardObject, Endpoint, NewObject } from './model/types'

/**
 * Copy and paste between boards (and browser tabs) goes through the system
 * clipboard, as a private format next to plain text for other apps.
 */

export const CLIPBOARD_TYPE = 'application/x-myoboard'

export interface ClipboardPayload {
  myoboard: 1
  /** The board the objects come from: images from elsewhere are copied over on paste. */
  board: string
  objects: BoardObject[]
}

/**
 * What copying the selection takes along: the objects, everything inside
 * selected sections, and connectors between copied objects. A connector end
 * attached to something left behind becomes a free end where it was.
 */
export function copySelection(snapshot: BoardSnapshot, selection: readonly string[], board: string): ClipboardPayload | null {
  const lookup = (id: string) => snapshot.byId.get(id)
  const chosen = new Set(selection.filter((id) => snapshot.byId.has(id)))
  for (const id of [...chosen]) {
    const obj = lookup(id)
    if (obj?.type !== 'section') continue
    for (const inner of objectsInside(objectBounds(obj)!, snapshot.ordered, lookup)) chosen.add(inner.id)
  }
  for (const obj of snapshot.ordered) {
    if (obj.type === 'connector' && isAttached(obj.from) && isAttached(obj.to) && chosen.has(obj.from.id) && chosen.has(obj.to.id)) chosen.add(obj.id)
  }
  const objects = snapshot.ordered
    .filter((obj) => chosen.has(obj.id))
    .map((obj): BoardObject => {
      if (obj.type !== 'connector') return obj
      const route = connectorRoute(obj, lookup)
      const loosen = (end: Endpoint, at: Point | undefined): Endpoint =>
        isAttached(end) && !chosen.has(end.id) && at ? { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } : end
      return { ...obj, from: loosen(obj.from, route?.start), to: loosen(obj.to, route?.end) }
    })
  return objects.length > 0 ? { myoboard: 1, board, objects } : null
}

/** The words on the copied objects, for pasting into other apps. */
export function plainText(payload: ClipboardPayload): string {
  return payload.objects
    .map((obj) => {
      if (obj.type === 'section') return obj.title
      if (obj.type === 'connector') return obj.label ?? ''
      return 'text' in obj ? obj.text : ''
    })
    .filter((text) => text.trim())
    .join('\n')
}

export function parsePayload(text: string): ClipboardPayload | null {
  try {
    const data = JSON.parse(text) as Partial<ClipboardPayload>
    if (data.myoboard !== 1 || typeof data.board !== 'string' || !Array.isArray(data.objects)) return null
    const objects = data.objects.filter(
      (obj): obj is BoardObject => !!obj && typeof obj === 'object' && typeof obj.id === 'string' && typeof obj.type === 'string',
    )
    return { myoboard: 1, board: data.board, objects }
  } catch {
    return null
  }
}

/**
 * Objects ready to insert: connectors whose attached ends point at nothing
 * in the payload or on the board are dropped.
 */
export function pasteable(objects: readonly BoardObject[], existsOnBoard: (id: string) => boolean): BoardObject[] {
  const ids = new Set(objects.map((obj) => obj.id))
  const ok = (end: Endpoint) => !isAttached(end) || ids.has(end.id) || existsOnBoard(end.id)
  return objects.filter((obj) => obj.type !== 'connector' || (ok(obj.from) && ok(obj.to)))
}

/** Bounds of a set of objects, connectors resolved among themselves. */
export function boundsOf(objects: readonly BoardObject[]): Box | null {
  const byId = new Map(objects.map((obj) => [obj.id, obj]))
  const lookup = (id: string) => byId.get(id)
  return unionBoxes(objects.flatMap((obj) => objectBounds(obj, lookup) ?? []))
}

/**
 * Plain text pasted onto the board: one sticky note per line for a short
 * list (great for brainstorm notes), one text block otherwise.
 */
export function textToObjects(text: string, at: Point, author: string, stickyColor: string): NewObject[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  if (lines.length <= 30 && lines.every((line) => line.length <= 200)) {
    const columns = Math.min(lines.length, Math.ceil(Math.sqrt(lines.length)))
    const rows = Math.ceil(lines.length / columns)
    const size = 200
    const gap = 20
    const left = at.x - (columns * size + (columns - 1) * gap) / 2
    const top = at.y - (rows * size + (rows - 1) * gap) / 2
    return lines.map((line, i) => ({
      type: 'sticky' as const,
      x: Math.round(left + (i % columns) * (size + gap)),
      y: Math.round(top + Math.floor(i / columns) * (size + gap)),
      w: size,
      h: size,
      color: stickyColor,
      text: line,
      author,
    }))
  }
  return [{ type: 'text' as const, x: Math.round(at.x - 200), y: Math.round(at.y - 20), w: 400, text: lines.join('\n'), fontSize: 20, color: '#1d1d1b', author }]
}
