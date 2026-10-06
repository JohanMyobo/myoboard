import { PEN_COLORS, SHAPE_COLORS, STAMPS, STICKY_COLORS } from './model/palette'
import type { ShapeKind } from './model/types'

export type Tool = 'select' | 'hand' | 'sticky' | 'shape' | 'text' | 'pen' | 'connector' | 'section' | 'stamp'

/** Settings for what the next created object looks like. */
export interface ToolOptions {
  stickyColor: string
  shapeKind: ShapeKind
  shapeColor: string
  penColor: string
  penWidth: number
  stamp: string
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  stickyColor: STICKY_COLORS[0].value,
  shapeKind: 'rect',
  shapeColor: SHAPE_COLORS[0].value,
  penColor: PEN_COLORS[0].value,
  penWidth: 4,
  stamp: STAMPS[0],
}

/** Single-key shortcuts (without modifiers). */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  s: 'sticky',
  r: 'shape',
  t: 'text',
  p: 'pen',
  c: 'connector',
  f: 'section',
  e: 'stamp',
}

export const DEFAULT_SIZES = {
  sticky: 200,
  shape: { w: 160, h: 100 },
  section: { w: 560, h: 360 },
  textWidth: 280,
  textFontSize: 20,
} as const
