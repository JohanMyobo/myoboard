import { describe, expect, it } from 'vitest'
import { boundaryPoint } from './geometry'
import { SHAPES, labelBox, rayExit, shapeOutline } from './shapes'

function inside(polygon: number[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

describe('shapes', () => {
  const w = 200
  const h = 120

  it('keeps every outline inside its box', () => {
    for (const { kind } of SHAPES) {
      const outline = shapeOutline(kind, w, h)
      if (!outline) continue
      for (let i = 0; i < outline.length; i += 2) {
        expect(outline[i]).toBeGreaterThanOrEqual(-1e-9)
        expect(outline[i]).toBeLessThanOrEqual(w + 1e-9)
        expect(outline[i + 1]).toBeGreaterThanOrEqual(-1e-9)
        expect(outline[i + 1]).toBeLessThanOrEqual(h + 1e-9)
      }
    }
  })

  it('puts the label inside the shape', () => {
    for (const { kind } of SHAPES) {
      const box = labelBox(kind, w, h)
      expect(box.w).toBeGreaterThan(0)
      expect(box.h).toBeGreaterThan(0)
      const outline = shapeOutline(kind, w, h)
      if (outline) expect(inside(outline, box.x + box.w / 2, box.y + box.h / 2), kind).toBe(true)
    }
  })

  it('attaches connectors to the real outline', () => {
    const box = { x: 100, y: 100, w, h }
    expect(boundaryPoint(box, 'triangle', { x: 200, y: -500 })).toEqual({ x: 200, y: 100 })
    expect(boundaryPoint(box, 'hexagon', { x: -500, y: 160 })).toEqual({ x: 100, y: 160 })
    const cylinderTop = boundaryPoint(box, 'cylinder', { x: 200, y: -500 })
    expect(cylinderTop.y).toBeCloseTo(100, 5)
    // A star's tip points up; between tips the outline is much closer to the centre.
    expect(boundaryPoint(box, 'star', { x: 200, y: -500 }).y).toBeCloseTo(100, 5)
    expect(boundaryPoint(box, 'star', { x: 200, y: 900 }).y).toBeLessThan(220 - 10)
  })

  it('reports no exit for a ray that misses the polygon', () => {
    expect(rayExit([0, 0, 10, 0, 10, 10, 0, 10], 20, 20, 1, 1)).toBeNull()
  })
})
