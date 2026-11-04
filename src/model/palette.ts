/** Colours and type settings shared by the canvas and the UI. */

/** Myobo's brand blues: navy for ink-like accents, sky for selection and focus. */
export const BRAND_NAVY = '#0d3272'
export const BRAND_SKY = '#38b6ff'

export const INK = '#101c33'
export const ACCENT = BRAND_SKY
export const FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
export const LINE_HEIGHT = 1.3

export const STICKY_COLORS = [
  { name: 'Lemon', value: '#ffe47a' },
  { name: 'Apricot', value: '#ffbf8f' },
  { name: 'Rose', value: '#ffadc4' },
  { name: 'Lilac', value: '#cfc0ff' },
  { name: 'Sky', value: '#9bd8ff' },
  { name: 'Mint', value: '#93e6cf' },
  { name: 'Lime', value: '#cdeb94' },
  { name: 'Stone', value: '#e3e7ee' },
] as const

export const SHAPE_COLORS = [
  { name: 'White', value: '#ffffff' },
  ...STICKY_COLORS,
  { name: 'Ink', value: '#2b3650' },
] as const

export const SECTION_COLORS = [
  { name: 'Paper', value: '#f4f6fa' },
  { name: 'Lemon', value: '#fff5cf' },
  { name: 'Rose', value: '#ffe7ef' },
  { name: 'Sky', value: '#e1f3ff' },
  { name: 'Mint', value: '#dcf6ee' },
  { name: 'Lilac', value: '#eeeaff' },
] as const

export const PEN_COLORS = [
  { name: 'Ink', value: '#101c33' },
  { name: 'Navy', value: '#0d3272' },
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Blue', value: '#38b6ff' },
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

/** The fill darkened by `amount` (0 to 1), for a sticky note's folded corner. Other colours are returned as they are. */
export function darken(fill: string, amount: number): string {
  const hex = fill.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fill
  const channel = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

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
