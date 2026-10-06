import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SHAPES, cylinderCap, shapeOutline } from '../model/shapes'
import type { ShapeKind } from '../model/types'

interface SwatchesProps {
  colors: readonly { name: string; value: string }[]
  value: string | null
  onChange(value: string): void
}

export function Swatches({ colors, value, onChange }: SwatchesProps) {
  return (
    <div className="swatches" role="group">
      {colors.map((color) => (
        <button
          key={color.value}
          type="button"
          className="swatch"
          style={{ background: color.value }}
          aria-label={color.name}
          aria-pressed={value === color.value}
          title={color.name}
          onClick={() => onChange(color.value)}
        />
      ))}
    </div>
  )
}

/** A shape's icon, drawn from the same outline as the shape on the board. */
export function ShapeIcon({ kind, size = 18 }: { kind: ShapeKind; size?: number }) {
  const w = size
  const h = Math.round(size * 0.8)
  const pad = 1.5
  const iw = w - 2 * pad
  const ih = h - 2 * pad
  const outline = shapeOutline(kind, iw, ih)
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' as const }
  let body
  if (kind === 'rect') body = <rect x={pad} y={pad} width={iw} height={ih} rx={2} {...stroke} />
  else if (kind === 'ellipse') body = <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} {...stroke} />
  else {
    const coords = (outline ?? []).map((v) => (v + pad).toFixed(2))
    const points: string[] = []
    for (let i = 0; i + 1 < coords.length; i += 2) points.push(`${coords[i]},${coords[i + 1]}`)
    const ry = cylinderCap(iw, ih) / 2
    body = (
      <>
        <polygon points={points.join(' ')} {...stroke} />
        {kind === 'cylinder' && <path d={`M${pad} ${pad + ry} A${iw / 2} ${ry} 0 0 0 ${pad + iw} ${pad + ry}`} {...stroke} />}
      </>
    )
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {body}
    </svg>
  )
}

interface ShapeKindPickerProps {
  value: ShapeKind | null
  onChange(kind: ShapeKind): void
  /** One button that opens the grid, for tight spaces such as the selection bar. */
  compact?: boolean
}

export function ShapeKindPicker({ value, onChange, compact = false }: ShapeKindPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const grid = (
    <div className="shape-grid" role="group" aria-label="Shape">
      {SHAPES.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={value === kind}
          onClick={() => {
            onChange(kind)
            setOpen(false)
          }}
        >
          <ShapeIcon kind={kind} />
        </button>
      ))}
    </div>
  )
  if (!compact) return grid
  const current = SHAPES.find((s) => s.kind === value)
  return (
    <div className="shape-menu" ref={ref}>
      <button type="button" className="shape-menu-button" aria-label={`Shape: ${current?.label ?? 'mixed'}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value ? <ShapeIcon kind={value} /> : <ShapeIcon kind="rect" />}
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && <div className="panel popover shape-popover">{grid}</div>}
    </div>
  )
}
