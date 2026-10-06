import { BringToFront, Copy, Trash2 } from 'lucide-react'
import type { Board } from '../model/board'
import { PEN_COLORS, SECTION_COLORS, SHAPE_COLORS, STICKY_COLORS } from '../model/palette'
import type { BoardObject, ShapeKind } from '../model/types'
import { ShapeKindPicker, Swatches } from './Swatches'

interface ContextBarProps {
  board: Board
  selected: BoardObject[]
  /** Screen position of the bar's top centre. */
  position: { x: number; y: number }
  onDuplicate(): void
  onDelete(): void
}

const PALETTES = {
  sticky: STICKY_COLORS,
  shape: SHAPE_COLORS,
  section: SECTION_COLORS,
  pen: PEN_COLORS,
} as const

/** Actions for the current selection: colour, shape, order, duplicate, delete. */
export function ContextBar({ board, selected, position, onDuplicate, onDelete }: ContextBarProps) {
  if (selected.length === 0) return null
  const types = new Set(selected.map((obj) => obj.type))
  const onlyType = types.size === 1 ? selected[0].type : null
  const palette = onlyType && onlyType in PALETTES ? PALETTES[onlyType as keyof typeof PALETTES] : null
  const colors = new Set(selected.map((obj) => ('color' in obj ? obj.color : '')))
  const currentColor = colors.size === 1 ? [...colors][0] : null
  const shapes = selected.filter((obj) => obj.type === 'shape')
  const kinds = new Set(shapes.map((obj) => obj.kind))
  const ids = selected.map((obj) => obj.id)

  const recolor = (color: string) => {
    board.checkpoint()
    board.updateMany(ids.map((id) => ({ id, patch: { color } })))
    board.checkpoint()
  }
  const reshape = (kind: ShapeKind) => {
    board.checkpoint()
    board.updateMany(shapes.map((obj) => ({ id: obj.id, patch: { kind } })))
    board.checkpoint()
  }

  return (
    <div className="panel context-bar" role="toolbar" aria-label="Selection" style={{ left: position.x, top: position.y }}>
      <span className="context-count">{selected.length === 1 ? labelFor(selected[0]) : `${selected.length} selected`}</span>
      {onlyType === 'shape' && <ShapeKindPicker value={kinds.size === 1 ? [...kinds][0] : null} onChange={reshape} />}
      {palette && <Swatches colors={palette} value={currentColor} onChange={recolor} />}
      <div className="context-actions">
        <button type="button" className="icon-button" aria-label="Bring to front" title="Bring to front" onClick={() => board.bringToFront(ids)}>
          <BringToFront size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button" aria-label="Duplicate" title="Duplicate (Ctrl/⌘ D)" onClick={onDuplicate}>
          <Copy size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-button danger" aria-label="Delete" title="Delete (Del)" onClick={onDelete}>
          <Trash2 size={18} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function labelFor(obj: BoardObject): string {
  switch (obj.type) {
    case 'sticky':
      return 'Sticky note'
    case 'shape':
      return 'Shape'
    case 'text':
      return 'Text'
    case 'pen':
      return 'Drawing'
    case 'connector':
      return 'Connector'
    case 'section':
      return 'Section'
    case 'stamp':
      return 'Stamp'
  }
}
