import { objectBounds, objectsInside, unionBoxes } from './geometry'
import type { Box, Lookup, Point } from './geometry'
import type { BoardObject, ObjectPatch } from './types'

/**
 * Arranging objects: guides that snap what you move or resize to the edges
 * and centres of what is around it, and aligning or spacing out a selection.
 */

/** A guide line: vertical (`axis: 'x'`, at x = `at`) or horizontal, from `from` to `to`. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

const xLines = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w]
const yLines = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h]

/** The shift (within `threshold`) that best lines `values` up with `lines`, or null. */
function bestShift(values: number[], lines: number[], threshold: number): number | null {
  let best: number | null = null
  for (const t of lines) {
    for (const v of values) {
      const d = t - v
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

/** Guides for every edge or centre of `box` that lines up with one of `others`. */
export function guidesFor(box: Box, others: readonly Box[], axes: { x: boolean; y: boolean } = { x: true, y: true }): Guide[] {
  const byLine = new Map<string, Guide>()
  const add = (axis: 'x' | 'y', at: number, from: number, to: number) => {
    const key = `${axis}:${Math.round(at * 10)}`
    const known = byLine.get(key)
    if (known) {
      known.from = Math.min(known.from, from)
      known.to = Math.max(known.to, to)
    } else {
      byLine.set(key, { axis, at, from, to })
    }
  }
  for (const o of others) {
    if (axes.x) {
      for (const t of xLines(o)) {
        if (xLines(box).some((v) => Math.abs(v - t) < 0.5)) add('x', t, Math.min(box.y, o.y), Math.max(box.y + box.h, o.y + o.h))
      }
    }
    if (axes.y) {
      for (const t of yLines(o)) {
        if (yLines(box).some((v) => Math.abs(v - t) < 0.5)) add('y', t, Math.min(box.x, o.x), Math.max(box.x + box.w, o.x + o.w))
      }
    }
  }
  return [...byLine.values()]
}

/**
 * Snaps a moving box: the smallest shift (each axis, within `threshold`) that
 * lines one of its edges or its centre up with an edge or centre of another
 * box, and the guides to draw.
 */
export function snapBox(moving: Box, others: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const dx = bestShift(xLines(moving), others.flatMap(xLines), threshold) ?? 0
  const dy = bestShift(yLines(moving), others.flatMap(yLines), threshold) ?? 0
  const moved = { ...moving, x: moving.x + dx, y: moving.y + dy }
  return { dx, dy, guides: guidesFor(moved, others) }
}

/** Snaps a point being dragged (a resize handle), on the axes it moves along. */
export function snapPoint(point: Point, axes: { x: boolean; y: boolean }, others: readonly Box[], threshold: number): Point {
  const dx = axes.x ? (bestShift([point.x], others.flatMap(xLines), threshold) ?? 0) : 0
  const dy = axes.y ? (bestShift([point.y], others.flatMap(yLines), threshold) ?? 0) : 0
  return { x: point.x + dx, y: point.y + dy }
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

interface Placed {
  id: string
  box: Box
}

/** How far each box moves to line up with the others (on the selection's own edges or centre). */
export function alignMoves(items: readonly Placed[], mode: AlignMode): Map<string, Point> {
  const moves = new Map<string, Point>()
  const all = unionBoxes(items.map((item) => item.box))
  if (!all || items.length < 2) return moves
  for (const { id, box } of items) {
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = all.x - box.x
    else if (mode === 'center') dx = all.x + all.w / 2 - (box.x + box.w / 2)
    else if (mode === 'right') dx = all.x + all.w - (box.x + box.w)
    else if (mode === 'top') dy = all.y - box.y
    else if (mode === 'middle') dy = all.y + all.h / 2 - (box.y + box.h / 2)
    else dy = all.y + all.h - (box.y + box.h)
    if (dx !== 0 || dy !== 0) moves.set(id, { x: dx, y: dy })
  }
  return moves
}

/** Moves that leave equal gaps between boxes along an axis; the first and last stay put. */
export function distributeMoves(items: readonly Placed[], axis: 'x' | 'y'): Map<string, Point> {
  const moves = new Map<string, Point>()
  if (items.length < 3) return moves
  const start = (b: Box) => (axis === 'x' ? b.x : b.y)
  const size = (b: Box) => (axis === 'x' ? b.w : b.h)
  const sorted = [...items].sort((a, b) => start(a.box) - start(b.box) || a.id.localeCompare(b.id))
  const first = sorted[0].box
  const last = sorted[sorted.length - 1].box
  const total = sorted.reduce((sum, item) => sum + size(item.box), 0)
  const gap = (start(last) + size(last) - start(first) - total) / (sorted.length - 1)
  let cursor = start(first) + size(first) + gap
  for (const { id, box } of sorted.slice(1, -1)) {
    const d = cursor - start(box)
    if (Math.abs(d) > 1e-9) moves.set(id, axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d })
    cursor += size(box) + gap
  }
  return moves
}

/** Boxes of the objects that can be aligned (everything but connectors). */
export function placedObjects(objects: readonly BoardObject[], lookup: Lookup): Placed[] {
  return objects.flatMap((obj) => {
    if (obj.type === 'connector') return []
    const box = objectBounds(obj, lookup)
    return box ? [{ id: obj.id, box }] : []
  })
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Patches that apply moves. A moved section carries what it holds, as when
 * it is dragged, except objects that have a move of their own.
 */
export function movePatches(moves: ReadonlyMap<string, Point>, ordered: readonly BoardObject[], lookup: Lookup): { id: string; patch: ObjectPatch }[] {
  const shifts = new Map<string, Point>()
  for (const [id, delta] of moves) {
    const obj = lookup(id)
    if (!obj || obj.type === 'connector') continue
    shifts.set(id, delta)
  }
  for (const [id, delta] of [...shifts]) {
    const obj = lookup(id)!
    if (obj.type !== 'section') continue
    for (const inner of objectsInside(objectBounds(obj)!, ordered, lookup)) {
      if (!moves.has(inner.id) && !shifts.has(inner.id)) shifts.set(inner.id, delta)
    }
  }
  return [...shifts].map(([id, delta]) => {
    const obj = lookup(id)!
    return { id, patch: { x: round1(obj.x + delta.x), y: round1(obj.y + delta.y) } }
  })
}
