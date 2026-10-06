import type Konva from 'konva'
import type { BoardSnapshot } from '../model/board'
import { objectBounds, unionBoxes } from '../model/geometry'
import type { Box } from '../model/geometry'
import type { Camera } from './camera'

const PADDING = 48
const MAX_PIXELS = 4096

/** Bounds of everything on the board, in world coordinates. */
export function contentBounds(snapshot: BoardSnapshot): Box | null {
  const lookup = (id: string) => snapshot.byId.get(id)
  return unionBoxes(
    snapshot.ordered.flatMap((obj) => {
      const box = objectBounds(obj, lookup)
      return box ? [box] : []
    }),
  )
}

/**
 * Renders the whole board (not just what is on screen) to a PNG on a white
 * background, without selection handles. Returns null for an empty board.
 */
export function renderBoardPng(stage: Konva.Stage, overlay: Konva.Layer | null, snapshot: BoardSnapshot, camera: Camera): string | null {
  const area = contentBounds(snapshot)
  if (!area) return null
  const world = { x: area.x - PADDING, y: area.y - PADDING, w: area.w + 2 * PADDING, h: area.h + 2 * PADDING }
  // Up to 2 pixels per board unit, capped so huge boards stay a sane size.
  const pixelsPerUnit = Math.min(2, MAX_PIXELS / Math.max(world.w, world.h))

  const transformers = stage.find('Transformer')
  transformers.forEach((t) => t.visible(false))
  overlay?.visible(false)
  let rendered: HTMLCanvasElement
  try {
    rendered = stage.toCanvas({
      x: world.x * camera.scale + camera.x,
      y: world.y * camera.scale + camera.y,
      width: world.w * camera.scale,
      height: world.h * camera.scale,
      pixelRatio: pixelsPerUnit / camera.scale,
    })
  } finally {
    transformers.forEach((t) => t.visible(true))
    overlay?.visible(true)
  }

  const out = document.createElement('canvas')
  out.width = rendered.width
  out.height = rendered.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(rendered, 0, 0)
  return out.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function fileNameFor(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'board'}.png`
}
