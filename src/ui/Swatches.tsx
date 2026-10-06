import { Circle, Diamond, Square } from 'lucide-react'
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

const KINDS: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: 'rect', label: 'Rectangle', icon: Square },
  { kind: 'ellipse', label: 'Ellipse', icon: Circle },
  { kind: 'diamond', label: 'Diamond', icon: Diamond },
]

export function ShapeKindPicker({ value, onChange }: { value: ShapeKind | null; onChange(kind: ShapeKind): void }) {
  return (
    <div className="segmented" role="group" aria-label="Shape">
      {KINDS.map(({ kind, label, icon: Icon }) => (
        <button key={kind} type="button" aria-label={label} title={label} aria-pressed={value === kind} onClick={() => onChange(kind)}>
          <Icon size={16} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  )
}
