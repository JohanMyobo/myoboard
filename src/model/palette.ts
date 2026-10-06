/** Colours and type settings shared by the canvas and the UI. */

export const INK = '#1d1d1b'
export const ACCENT = '#2563eb'
export const FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
export const LINE_HEIGHT = 1.3

export const STICKY_COLORS = [
  { name: 'Lemon', value: '#ffe58f' },
  { name: 'Apricot', value: '#ffc58a' },
  { name: 'Rose', value: '#ffb3c7' },
  { name: 'Lilac', value: '#d7c6ff' },
  { name: 'Sky', value: '#a9d4ff' },
  { name: 'Mint', value: '#9ee8d7' },
  { name: 'Lime', value: '#c5ec9f' },
  { name: 'Stone', value: '#e4e4e1' },
] as const

export const SHAPE_COLORS = [
  { name: 'White', value: '#ffffff' },
  ...STICKY_COLORS,
  { name: 'Ink', value: '#3a3a37' },
] as const

export const SECTION_COLORS = [
  { name: 'Paper', value: '#f7f6f2' },
  { name: 'Lemon', value: '#fff6d6' },
  { name: 'Rose', value: '#ffe8ee' },
  { name: 'Sky', value: '#e3f0ff' },
  { name: 'Mint', value: '#ddf7f0' },
  { name: 'Lilac', value: '#efe9ff' },
] as const

export const PEN_COLORS = [
  { name: 'Ink', value: '#1d1d1b' },
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Blue', value: '#0090ff' },
  { name: 'Violet', value: '#8e4ec6' },
] as const

export const STAMPS = ['👍', '❤️', '⭐', '🎉', '✅', '❓', '🔥', '💡'] as const

/** Colours used to tell people apart: cursors, selections, stamps. */
export const PEOPLE_COLORS = [
  '#e5484d',
  '#f76b15',
  '#d6a100',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
] as const

/** Readable text colour on top of a fill. */
export function textColorOn(fill: string): string {
  const hex = fill.replace('#', '')
  if (hex.length !== 6) return INK
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.5 ? '#ffffff' : INK
}
