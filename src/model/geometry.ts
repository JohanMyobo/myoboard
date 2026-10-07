import { LINE_HEIGHT } from './palette'
import { rayExit, shapeOutline } from './shapes'
import { isAttached } from './types'
import type { AnchorSide, BoardObject, ConnectorObject, Endpoint, ShapeKind } from './types'

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

export const ANCHOR_SIDES: readonly AnchorSide[] = ['top', 'right', 'bottom', 'left']

const SIDE_DIRECTION: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/** Where a side's anchor sits: on the outline, straight out from the centre. */
export function anchorPoint(box: Box, kind: ShapeKind, side: AnchorSide): Point {
  const c = center(box)
  const d = SIDE_DIRECTION[side]
  return boundaryPoint(box, kind, { x: c.x + d.x * 1e6, y: c.y + d.y * 1e6 })
}

/** The four anchors connectors can be pinned to, or none for a connector. */
export function anchorsOf(obj: BoardObject): { side: AnchorSide; point: Point }[] {
  if (obj.type === 'connector') return []
  const box = objectBounds(obj)
  if (!box) return []
  const kind = outlineKind(obj)
  return ANCHOR_SIDES.map((side) => ({ side, point: anchorPoint(box, kind, side) }))
}

/** What a connector end dropped somewhere attaches to; null leaves it free. */
export interface ConnectorTarget {
  id: string
  /** Set when the end is close enough to an anchor to snap onto it. */
  side?: AnchorSide
  point: Point
}

function nearestAnchor(obj: BoardObject, point: Point): { side: AnchorSide; point: Point; distance: number } | null {
  let best: { side: AnchorSide; point: Point; distance: number } | null = null
  for (const anchor of anchorsOf(obj)) {
    const distance = Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y)
    if (!best || distance < best.distance) best = { ...anchor, distance }
  }
  return best
}

/**
 * Where a connector end at `point` attaches. Anchors are magnetic: within
 * `radius` of one, the end snaps to it, even from just outside the object.
 * Elsewhere on an object the end attaches to the whole object, and in the
 * open it stays free (null). Objects in `exclude` are skipped.
 */
export function connectorTarget(
  point: Point,
  ordered: readonly BoardObject[],
  radius: number,
  exclude?: ReadonlySet<string>,
): ConnectorTarget | null {
  const hit = topmostAt(point, ordered, { exclude })
  if (hit) {
    const anchor = nearestAnchor(hit, point)
    if (anchor && anchor.distance <= radius) return { id: hit.id, side: anchor.side, point: anchor.point }
    return { id: hit.id, point: center(objectBounds(hit)!) }
  }
  // Just outside every object: the nearest anchor in reach, sections last.
  let best: (ConnectorTarget & { distance: number; section: boolean }) | null = null
  for (const obj of ordered) {
    if (obj.type === 'connector' || exclude?.has(obj.id)) continue
    const anchor = nearestAnchor(obj, point)
    if (!anchor || anchor.distance > radius) continue
    const section = obj.type === 'section'
    const better = !best || (best.section && !section) || (best.section === section && anchor.distance <= best.distance)
    if (better) best = { id: obj.id, side: anchor.side, point: anchor.point, distance: anchor.distance, section }
  }
  return best ? { id: best.id, side: best.side, point: best.point } : null
}

/** The endpoint a connector stores for a target (or a free point). */
export function endpointFor(target: ConnectorTarget | null, at: Point): Endpoint {
  if (!target) return { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 }
  return target.side ? { id: target.id, side: target.side } : { id: target.id }
}

interface ResolvedEnd {
  point: Point
  box: Box | null
  kind: ShapeKind
  side?: AnchorSide
}

function resolveEndpoint(endpoint: Endpoint, lookup: Lookup): ResolvedEnd | null {
  if (!isAttached(endpoint)) return { point: { x: endpoint.x, y: endpoint.y }, box: null, kind: 'rect' }
  const target = lookup(endpoint.id)
  if (!target || target.type === 'connector') return null
  const box = objectBounds(target, lookup)
  if (!box) return null
  return { point: center(box), box, kind: outlineKind(target), side: endpoint.side }
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

/** How far an elbow runs straight out of a pinned side before it may turn. */
const ELBOW_STUB = 24

/** Drops repeated points and bends that do not turn (including doubling back). */
function simplifyPath(corners: Point[]): Point[] {
  const path: Point[] = []
  for (const p of corners) {
    const last = path[path.length - 1]
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.01) continue
    const before = path[path.length - 2]
    if (before && Math.abs((last.x - before.x) * (p.y - before.y) - (last.y - before.y) * (p.x - before.x)) < 0.01) path.pop()
    path.push(p)
  }
  return path
}

/** The point halfway along a polyline. */
function halfway(path: Point[]): Point {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y))
  let left = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const t = left / lengths[i]
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t }
    }
    left -= lengths[i]
  }
  return path[path.length - 1]
}

/**
 * How a connector runs between its ends. An end pinned to a side leaves from
 * that side's anchor, heading straight out. Otherwise straight lines aim at
 * the other end, and elbows and curves leave from the side that faces it.
 * Elbows then bend at right angles, curves smoothly. Returns null if an
 * attached object is gone.
 */
export function connectorRoute(conn: Pick<ConnectorObject, 'from' | 'to' | 'style'>, lookup: Lookup): ConnectorRoute | null {
  const from = resolveEndpoint(conn.from, lookup)
  const to = resolveEndpoint(conn.to, lookup)
  if (!from || !to) return null
  const pin = (end: ResolvedEnd) => (end.side && end.box ? anchorPoint(end.box, end.kind, end.side) : null)
  const fromPin = pin(from)
  const toPin = pin(to)
  const fromAim = fromPin ?? from.point
  const toAim = toPin ?? to.point
  const style = conn.style ?? 'straight'
  if (style === 'straight') {
    const start = fromPin ?? (from.box ? boundaryPoint(from.box, from.kind, toAim) : from.point)
    const end = toPin ?? (to.box ? boundaryPoint(to.box, to.kind, fromAim) : to.point)
    return { points: [start.x, start.y, end.x, end.y], bezier: false, start, end, mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
  }

  // Ends that are not pinned leave along the main axis between the two ends.
  const dx = toAim.x - fromAim.x
  const dy = toAim.y - fromAim.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const facing: Point = horizontal ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 }
  const fromDir = from.side ? SIDE_DIRECTION[from.side] : facing
  const toDir = to.side ? SIDE_DIRECTION[to.side] : { x: -facing.x, y: -facing.y }
  const leave = (end: ResolvedEnd, dir: Point): Point =>
    end.box ? boundaryPoint(end.box, end.kind, { x: end.point.x + dir.x * 1e6, y: end.point.y + dir.y * 1e6 }) : end.point
  const start = fromPin ?? leave(from, fromDir)
  const end = toPin ?? leave(to, toDir)

  if (style === 'curved') {
    const reach = (dir: Point) => Math.max(30, (dir.x !== 0 ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * 0.5)
    const r1 = reach(fromDir)
    const r2 = reach(toDir)
    const c1 = { x: start.x + fromDir.x * r1, y: start.y + fromDir.y * r1 }
    const c2 = { x: end.x + toDir.x * r2, y: end.y + toDir.y * r2 }
    return { points: [start.x, start.y, c1.x, c1.y, c2.x, c2.y, end.x, end.y], bezier: true, start, end, mid: cubicAt(start, c1, c2, end, 0.5) }
  }

  // Elbow: a short stub out of each end, then right angles between the stubs.
  const a = { x: start.x + fromDir.x * ELBOW_STUB, y: start.y + fromDir.y * ELBOW_STUB }
  const b = { x: end.x + toDir.x * ELBOW_STUB, y: end.y + toDir.y * ELBOW_STUB }
  const fromH = fromDir.x !== 0
  const toH = toDir.x !== 0
  let between: Point[]
  if (fromH && toH) {
    const mx = (a.x + b.x) / 2
    between = [{ x: mx, y: a.y }, { x: mx, y: b.y }]
  } else if (!fromH && !toH) {
    const my = (a.y + b.y) / 2
    between = [{ x: a.x, y: my }, { x: b.x, y: my }]
  } else {
    between = [fromH ? { x: b.x, y: a.y } : { x: a.x, y: b.y }]
  }
  const path = simplifyPath([start, a, ...between, b, end])
  return { points: path.flatMap((p) => [p.x, p.y]), bezier: false, start, end, mid: halfway(path) }
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
