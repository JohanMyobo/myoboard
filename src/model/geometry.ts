import { LINE_HEIGHT } from './palette'
import { rayExit, shapeOutline } from './shapes'
import { isAttached } from './types'
import type { BoardObject, ConnectorObject, Endpoint, ShapeKind } from './types'

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Lookup = (id: string) => BoardObject | undefined

export const STICKY_PADDING = 16
export const STICKY_AUTHOR_SPACE = 18
export const STAMP_RADIUS = 20

/** Average glyph width as a fraction of the font size, for layout estimates. */
const CHAR_WIDTH = 0.56

/** Estimated height of wrapped text; good enough for hit tests and layout. */
export function estimateTextHeight(text: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH)))
  const lines = (text || ' ')
    .split('\n')
    .reduce((count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / charsPerLine)), 0)
  return lines * fontSize * LINE_HEIGHT
}

/** Largest font size (from `max` down, in steps of 2) at which the text fits the box. */
export function fitFontSize(text: string, width: number, height: number, max = 24, min = 10): number {
  for (let size = max; size > min; size -= 2) {
    if (estimateTextHeight(text, width, size) <= height) return size
  }
  return min
}

export function stickyTextBox(w: number, h: number): { width: number; height: number } {
  return {
    width: Math.max(1, w - 2 * STICKY_PADDING),
    height: Math.max(1, h - 2 * STICKY_PADDING - STICKY_AUTHOR_SPACE),
  }
}

export function textObjectHeight(text: string, w: number, fontSize: number): number {
  return Math.max(fontSize * LINE_HEIGHT, estimateTextHeight(text, w, fontSize))
}

export function boxFromPoints(points: Point[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function normalizeBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

export function intersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function containsPoint(box: Box, p: Point): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  return boxFromPoints(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]))
}

export function outlineKind(obj: BoardObject): ShapeKind {
  if (obj.type === 'shape') return obj.kind
  if (obj.type === 'stamp') return 'ellipse'
  return 'rect'
}

/** Bounding box of an object in world coordinates. Connectors need a lookup. */
export function objectBounds(obj: BoardObject, lookup?: Lookup): Box | null {
  switch (obj.type) {
    case 'sticky':
    case 'shape':
    case 'section':
    case 'image':
      return { x: obj.x, y: obj.y, w: obj.w, h: obj.h }
    case 'text':
      return { x: obj.x, y: obj.y, w: obj.w, h: textObjectHeight(obj.text, obj.w, obj.fontSize) }
    case 'stamp':
      return { x: obj.x - STAMP_RADIUS, y: obj.y - STAMP_RADIUS, w: 2 * STAMP_RADIUS, h: 2 * STAMP_RADIUS }
    case 'pen': {
      const points: Point[] = []
      for (let i = 0; i + 1 < obj.points.length; i += 2) {
        points.push({ x: obj.x + obj.points[i], y: obj.y + obj.points[i + 1] })
      }
      if (points.length === 0) return { x: obj.x, y: obj.y, w: 0, h: 0 }
      const box = boxFromPoints(points)
      const pad = obj.width / 2
      return { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }
    }
    case 'connector': {
      if (!lookup) return null
      const route = connectorRoute(obj, lookup)
      return route ? boxFromPoints(pointsOf(route.points)) : null
    }
  }
}

/** Where a line from the centre of `box` towards `toward` leaves the shape's outline. */
export function boundaryPoint(box: Box, kind: ShapeKind, toward: Point): Point {
  const c = center(box)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = box.w / 2
  const hh = box.h / 2
  if (hw === 0 || hh === 0) return c
  let t: number
  if (kind === 'ellipse') {
    t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
  } else {
    const outline = shapeOutline(kind, box.w, box.h)
    const exit = outline ? rayExit(outline, hw, hh, dx, dy) : null
    if (exit !== null) {
      t = exit
    } else {
      const tx = dx === 0 ? Infinity : hw / Math.abs(dx)
      const ty = dy === 0 ? Infinity : hh / Math.abs(dy)
      t = Math.min(tx, ty)
    }
  }
  return { x: c.x + dx * t, y: c.y + dy * t }
}

interface ResolvedEnd {
  point: Point
  box: Box | null
  kind: ShapeKind
}

function resolveEndpoint(endpoint: Endpoint, lookup: Lookup): ResolvedEnd | null {
  if (!isAttached(endpoint)) return { point: { x: endpoint.x, y: endpoint.y }, box: null, kind: 'rect' }
  const target = lookup(endpoint.id)
  if (!target || target.type === 'connector') return null
  const box = objectBounds(target, lookup)
  if (!box) return null
  return { point: center(box), box, kind: outlineKind(target) }
}

function pointsOf(flat: readonly number[]): Point[] {
  const points: Point[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] })
  return points
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

/** The line a connector draws, and where its label goes. */
export interface ConnectorRoute {
  /** Flat [x0, y0, ...]; for a curve: start, two control points, end. */
  points: number[]
  bezier: boolean
  start: Point
  end: Point
  /** Halfway along: where the label sits. */
  mid: Point
}

/**
 * How a connector runs between its ends. Straight lines aim at the other
 * end's centre. Elbows and curves leave each object from the side that
 * faces the other end, then bend: elbows at right angles, curves smoothly.
 * Returns null if an attached object is gone.
 */
export function connectorRoute(conn: Pick<ConnectorObject, 'from' | 'to' | 'style'>, lookup: Lookup): ConnectorRoute | null {
  const from = resolveEndpoint(conn.from, lookup)
  const to = resolveEndpoint(conn.to, lookup)
  if (!from || !to) return null
  const style = conn.style ?? 'straight'
  if (style === 'straight') {
    const start = from.box ? boundaryPoint(from.box, from.kind, to.point) : from.point
    const end = to.box ? boundaryPoint(to.box, to.kind, from.point) : to.point
    return { points: [start.x, start.y, end.x, end.y], bezier: false, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
  }

  const dx = to.point.x - from.point.x
  const dy = to.point.y - from.point.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const sx = horizontal ? Math.sign(dx) || 1 : 0
  const sy = horizontal ? 0 : Math.sign(dy) || 1
  const leave = (end: ResolvedEnd, dirX: number, dirY: number): Point =>
    end.box ? boundaryPoint(end.box, end.kind, { x: end.point.x + dirX * 1e6, y: end.point.y + dirY * 1e6 }) : end.point
  const start = leave(from, sx, sy)
  const end = leave(to, -sx, -sy)

  if (style === 'curved') {
    const reach = Math.max(30, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * 0.5)
    const c1 = { x: start.x + sx * reach, y: start.y + sy * reach }
    const c2 = { x: end.x - sx * reach, y: end.y - sy * reach }
    return { points: [start.x, start.y, c1.x, c1.y, c2.x, c2.y, end.x, end.y], bezier: true, start, end, mid: cubicAt(start, c1, c2, end, 0.5) }
  }

  const corners = horizontal
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
  // Drop repeated points and bends that do not turn (objects already aligned).
  const path: Point[] = []
  for (const p of corners) {
    const last = path[path.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.01) continue
    const before = path[path.length - 2]
    if (before && Math.abs((last.x - before.x) * (p.y - before.y) - (last.y - before.y) * (p.x - before.x)) < 0.01) path.pop()
    path.push(p)
  }
  const mid = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }
  return { points: path.flatMap((p) => [p.x, p.y]), bezier: false, start, end, mid }
}

/**
 * Start and end of a connector: attached ends sit on the outline of their
 * object. Returns null if an attached object is gone.
 */
export function connectorEnds(conn: Pick<ConnectorObject, 'from' | 'to' | 'style'>, lookup: Lookup): { start: Point; end: Point } | null {
  const route = connectorRoute(conn, lookup)
  return route ? { start: route.start, end: route.end } : null
}

/**
 * Topmost object under a point, ignoring connectors. Sections sit under
 * everything else, so they only win when nothing is on top of them.
 */
export function topmostAt(
  point: Point,
  ordered: readonly BoardObject[],
  options: { exclude?: ReadonlySet<string>; includeSections?: boolean } = {},
): BoardObject | null {
  const { exclude, includeSections = true } = options
  let section: BoardObject | null = null
  for (let i = ordered.length - 1; i >= 0; i--) {
    const obj = ordered[i]
    if (obj.type === 'connector' || exclude?.has(obj.id)) continue
    const box = objectBounds(obj)
    if (!box || !containsPoint(box, point)) continue
    if (obj.type === 'section') {
      section ??= obj
      continue
    }
    return obj
  }
  return includeSections ? section : null
}

/** Objects that move along with a section: everything fully inside it. */
export function objectsInside(section: Box, ordered: readonly BoardObject[], lookup: Lookup): BoardObject[] {
  return ordered.filter((obj) => {
    if (obj.type === 'section' || obj.type === 'connector') return false
    const box = objectBounds(obj, lookup)
    return box !== null && contains(section, box)
  })
}
