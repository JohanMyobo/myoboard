import type { Box, Point } from '../model/geometry'

/** Screen = world × scale + (x, y). */
export interface Camera {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function toWorld(camera: Camera, screen: Point): Point {
  return { x: (screen.x - camera.x) / camera.scale, y: (screen.y - camera.y) / camera.scale }
}

export function toScreen(camera: Camera, world: Point): Point {
  return { x: world.x * camera.scale + camera.x, y: world.y * camera.scale + camera.y }
}

/** Zooms so the world point under `screen` stays under it. */
export function zoomAt(camera: Camera, screen: Point, nextScale: number): Camera {
  const scale = clampScale(nextScale)
  const world = toWorld(camera, screen)
  return { scale, x: screen.x - world.x * scale, y: screen.y - world.y * scale }
}

/** Camera that shows `box` centred in a viewport, never zooming in past `maxScale`. */
export function fitBox(box: Box, viewport: { width: number; height: number }, padding = 96, maxScale = 1): Camera {
  const availableW = Math.max(1, viewport.width - 2 * padding)
  const availableH = Math.max(1, viewport.height - 2 * padding)
  const scale = clampScale(Math.min(maxScale, availableW / Math.max(1, box.w), availableH / Math.max(1, box.h)))
  return {
    scale,
    x: viewport.width / 2 - (box.x + box.w / 2) * scale,
    y: viewport.height / 2 - (box.y + box.h / 2) * scale,
  }
}

/** The part of the world currently on screen. */
export function visibleWorld(camera: Camera, viewport: { width: number; height: number }): Box {
  const topLeft = toWorld(camera, { x: 0, y: 0 })
  return { x: topLeft.x, y: topLeft.y, w: viewport.width / camera.scale, h: viewport.height / camera.scale }
}

/**
 * The region whose objects get drawn: the 3x3 block of viewport-sized cells
 * around the one on screen. Snapping to cells keeps it stable while panning,
 * so objects are not mounted and unmounted on every frame.
 */
export function drawRegion(camera: Camera, viewport: { width: number; height: number }): Box {
  const view = visibleWorld(camera, viewport)
  const cellW = Math.max(1, view.w)
  const cellH = Math.max(1, view.h)
  return {
    x: (Math.floor(view.x / cellW) - 1) * cellW,
    y: (Math.floor(view.y / cellH) - 1) * cellH,
    w: cellW * 3,
    h: cellH * 3,
  }
}
