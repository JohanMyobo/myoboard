import type Konva from 'konva'
import type { BoardSnapshot } from '../model/board'
import { objectBounds, unionBoxes } from '../model/geometry'
import type { Box } from '../model/geometry'
import type { Camera } from './camera'
import { jpegToPdf } from './pdf'

const PADDING = 48
const MAX_PIXELS = 4096

export type ExportFormat = 'png' | 'jpg' | 'pdf'

/** Bounds of everything on the board (or just `only`), in world coordinates. */
export function contentBounds(snapshot: BoardSnapshot, only: ReadonlySet<string> | null = null): Box | null {
  const lookup = (id: string) => snapshot.byId.get(id)
  return unionBoxes(
    snapshot.ordered.flatMap((obj) => {
      if (only && !only.has(obj.id)) return []
      const box = objectBounds(obj, lookup)
      return box ? [box] : []
    }),
  )
}

/**
 * Draws the whole board, or only the objects in `only`, on a white
 * background without selection handles. Returns null when there is nothing.
 */
export function renderBoard(
  stage: Konva.Stage,
  overlay: Konva.Layer | null,
  snapshot: BoardSnapshot,
  camera: Camera,
  only: ReadonlySet<string> | null = null,
): HTMLCanvasElement | null {
  const area = contentBounds(snapshot, only)
  if (!area) return null
  const world = { x: area.x - PADDING, y: area.y - PADDING, w: area.w + 2 * PADDING, h: area.h + 2 * PADDING }
  // Up to 2 pixels per board unit, capped so huge boards stay a sane size.
  const pixelsPerUnit = Math.min(2, MAX_PIXELS / Math.max(world.w, world.h))

  const hidden: Konva.Node[] = [...stage.find('Transformer')]
  if (only) hidden.push(...stage.find('.object').filter((node) => !only.has(node.id())))
  if (overlay) hidden.push(overlay)
  const wasVisible = hidden.map((node) => node.visible())
  hidden.forEach((node) => node.visible(false))
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
    hidden.forEach((node, i) => node.visible(wasVisible[i]))
  }

  const out = document.createElement('canvas')
  out.width = rendered.width
  out.height = rendered.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(rendered, 0, 0)
  return out
}

/** The rendered board as a file: a data URL for images, a blob URL for PDF. */
export function encodeBoard(canvas: HTMLCanvasElement, format: ExportFormat): string {
  if (format === 'png') return canvas.toDataURL('image/png')
  const jpeg = canvas.toDataURL('image/jpeg', 0.92)
  if (format === 'jpg') return jpeg
  const bytes = Uint8Array.from(atob(jpeg.slice(jpeg.indexOf(',') + 1)), (c) => c.charCodeAt(0))
  return URL.createObjectURL(new Blob([jpegToPdf(bytes, canvas.width, canvas.height)], { type: 'application/pdf' }))
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (dataUrl.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(dataUrl), 10_000)
}

export function fileNameFor(title: string, format: ExportFormat = 'png'): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'board'}.${format}`
}
