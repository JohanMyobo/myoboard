import type { ShapeKind } from './types'

/**
 * Outlines of the shapes, in the shape's own box (0, 0)–(w, h). The canvas
 * draws them, connectors attach to them, and the toolbar icons are drawn
 * from them, so all three always agree.
 */

export interface ShapeInfo {
  kind: ShapeKind
  label: string
}

export const SHAPES: readonly ShapeInfo[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'pill', label: 'Pill' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'star', label: 'Star' },
  { kind: 'cylinder', label: 'Cylinder' },
]

export const isShapeKind = (value: unknown): value is ShapeKind => SHAPES.some((s) => s.kind === value)

/** Height of a cylinder's top and bottom caps. */
export const cylinderCap = (w: number, h: number): number => Math.min(h * 0.25, w * 0.3, 40)

export const pillRadius = (w: number, h: number): number => Math.min(w, h) / 2

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): number[] {
  const points: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    points.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t))
  }
  return points
}

/**
 * The outline as a flat [x0, y0, x1, y1, ...] polygon. Curved shapes are
 * sampled finely enough for connectors to meet them. Rectangles and
 * ellipses return null: they are handled exactly.
 */
export function shapeOutline(kind: ShapeKind, w: number, h: number): number[] | null {
  switch (kind) {
    case 'rect':
    case 'ellipse':
      return null
    case 'diamond':
      return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]
    case 'triangle':
      return [w / 2, 0, w, h, 0, h]
    case 'hexagon': {
      const inset = Math.min(w * 0.25, h * 0.5)
      return [inset, 0, w - inset, 0, w, h / 2, w - inset, h, inset, h, 0, h / 2]
    }
    case 'parallelogram': {
      const skew = Math.min(w * 0.25, h * 0.5)
      return [skew, 0, w, 0, w - skew, h, 0, h]
    }
    case 'arrow': {
      const head = Math.min(w * 0.45, h * 0.9)
      return [0, h * 0.25, w - head, h * 0.25, w - head, 0, w, h / 2, w - head, h, w - head, h * 0.75, 0, h * 0.75]
    }
    case 'star': {
      const points: number[] = []
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 1 : 0.45
        points.push(w / 2 + (w / 2) * r * Math.cos(angle), h / 2 + (h / 2) * r * Math.sin(angle))
      }
      return points
    }
    case 'pill': {
      const r = pillRadius(w, h)
      if (w >= h) return [...arc(w - r, r, r, r, -Math.PI / 2, Math.PI / 2, 8), ...arc(r, r, r, r, Math.PI / 2, (3 * Math.PI) / 2, 8)]
      return [...arc(r, h - r, r, r, 0, Math.PI, 8), ...arc(r, r, r, r, Math.PI, 2 * Math.PI, 8)]
    }
    case 'cylinder': {
      const cap = cylinderCap(w, h) / 2
      return [...arc(w / 2, cap, w / 2, cap, Math.PI, 2 * Math.PI, 12), ...arc(w / 2, h - cap, w / 2, cap, 0, Math.PI, 12)]
    }
  }
}

/** Where a label fits inside the shape, in the shape's own box. */
export function labelBox(kind: ShapeKind, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const inset = (fx: number, fy: number, dy = 0) => ({ x: (w * (1 - fx)) / 2, y: (h * (1 - fy)) / 2 + h * dy, w: w * fx, h: h * fy })
  switch (kind) {
    case 'rect':
      return { x: 0, y: 0, w, h }
    case 'pill': {
      const side = pillRadius(w, h) * 0.3
      return w >= h ? { x: side, y: 0, w: w - 2 * side, h } : { x: 0, y: side, w, h: h - 2 * side }
    }
    case 'ellipse':
      return inset(0.72, 0.72)
    case 'diamond':
      return inset(0.56, 0.56)
    case 'triangle':
      return { x: w * 0.22, y: h * 0.42, w: w * 0.56, h: h * 0.54 }
    case 'hexagon': {
      const side = Math.min(w * 0.25, h * 0.5) * 0.6
      return { x: side, y: 0, w: w - 2 * side, h }
    }
    case 'parallelogram': {
      const skew = Math.min(w * 0.25, h * 0.5)
      return { x: skew * 0.6, y: 0, w: w - skew * 1.2, h }
    }
    case 'arrow': {
      const head = Math.min(w * 0.45, h * 0.9)
      return { x: 0, y: h * 0.2, w: w - head * 0.35, h: h * 0.6 }
    }
    case 'star':
      return inset(0.46, 0.4, 0.04)
    case 'cylinder': {
      const cap = cylinderCap(w, h)
      return { x: 0, y: cap, w, h: h - cap * 1.5 }
    }
  }
}

/**
 * Where a ray from (cx, cy) in direction (dx, dy) first leaves a polygon, as
 * a multiple of (dx, dy), or null if it never does.
 */
export function rayExit(polygon: readonly number[], cx: number, cy: number, dx: number, dy: number): number | null {
  let best: number | null = null
  const n = polygon.length / 2
  for (let i = 0; i < n; i++) {
    const ax = polygon[2 * i]
    const ay = polygon[2 * i + 1]
    const bx = polygon[(2 * (i + 1)) % polygon.length]
    const by = polygon[(2 * (i + 1) + 1) % polygon.length]
    const ex = bx - ax
    const ey = by - ay
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-12) continue
    const t = ((ax - cx) * ey - (ay - cy) * ex) / denom
    const u = ((ax - cx) * dy - (ay - cy) * dx) / denom
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t
  }
  return best
}
