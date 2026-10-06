import { describe, expect, it } from 'vitest'
import { MAX_SCALE, drawRegion, fitBox, toScreen, toWorld, visibleWorld, zoomAt } from './camera'

describe('camera', () => {
  const camera = { x: 100, y: 50, scale: 2 }

  it('converts between screen and world', () => {
    const world = toWorld(camera, { x: 300, y: 250 })
    expect(world).toEqual({ x: 100, y: 100 })
    expect(toScreen(camera, world)).toEqual({ x: 300, y: 250 })
  })

  it('keeps the point under the pointer fixed while zooming', () => {
    const pointer = { x: 400, y: 300 }
    const before = toWorld(camera, pointer)
    const zoomed = zoomAt(camera, pointer, 3)
    const after = toWorld(zoomed, pointer)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps the zoom level', () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE)
  })

  it('fits a box in the viewport without zooming in past 100%', () => {
    const fit = fitBox({ x: 0, y: 0, w: 100, h: 100 }, { width: 1000, height: 800 })
    expect(fit.scale).toBe(1)
    expect(toScreen(fit, { x: 50, y: 50 })).toEqual({ x: 500, y: 400 })
    const big = fitBox({ x: 0, y: 0, w: 4000, h: 1000 }, { width: 1000, height: 800 }, 0)
    expect(big.scale).toBeCloseTo(0.25)
  })

  it('reports the visible part of the world', () => {
    expect(visibleWorld({ x: -100, y: 0, scale: 0.5 }, { width: 800, height: 600 })).toEqual({ x: 200, y: 0, w: 1600, h: 1200 })
  })

  it('draws a stable region that always covers the screen', () => {
    const viewport = { width: 800, height: 600 }
    const a = drawRegion({ x: 0, y: 0, scale: 1 }, viewport)
    const b = drawRegion({ x: -100, y: -50, scale: 1 }, viewport)
    expect(b).toEqual(a)
    for (const camera of [{ x: -1234, y: 567, scale: 0.7 }, { x: 99, y: -4000, scale: 2.5 }]) {
      const view = visibleWorld(camera, viewport)
      const region = drawRegion(camera, viewport)
      expect(region.x).toBeLessThanOrEqual(view.x)
      expect(region.y).toBeLessThanOrEqual(view.y)
      expect(region.x + region.w).toBeGreaterThanOrEqual(view.x + view.w)
      expect(region.y + region.h).toBeGreaterThanOrEqual(view.y + view.h)
    }
  })
})
