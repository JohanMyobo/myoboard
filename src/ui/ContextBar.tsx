import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  Copy,
  CornerDownRight,
  Minus,
  MoveHorizontal,
  MoveRight,
  Spline,
  Trash2,
  Type,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { alignMoves, distributeMoves, movePatches, placedObjects } from '../model/arrange'
import type { AlignMode } from '../model/arrange'
import type { Board } from '../model/board'
import type { Point } from '../model/geometry'
import { PEN_COLORS, SECTION_COLORS, SHAPE_COLORS, STICKY_COLORS } from '../model/palette'
import type { ArrowHeads, BoardObject, ConnectorObject, ConnectorStyle, ObjectPatch, ShapeKind } from '../model/types'
import { MenuButton } from './MenuButton'
import { ShapeKindPicker, Swatches } from './Swatches'

interface ContextBarProps {
  board: Board
  selected: BoardObject[]
  /** Screen position of the bar's top centre. */
  position: { x: number; y: number }
  onDuplicate(): void
  onDelete(): void
  /** Starts editing an object's text (a connector's label). */
  onEditText(id: string): void
}

const PALETTES = {
  sticky: STICKY_COLORS,
  shape: SHAPE_COLORS,
  section: SECTION_COLORS,
  pen: PEN_COLORS,
  connector: PEN_COLORS,
} as const

export const CONNECTOR_STYLES: { value: ConnectorStyle; label: string; icon: LucideIcon }[] = [
  { value: 'straight', label: 'Straight', icon: Minus },
  { value: 'elbow', label: 'Elbow', icon: CornerDownRight },
  { value: 'curved', label: 'Curved', icon: Spline },
]

const ARROWS: { value: ArrowHeads; label: string; icon: LucideIcon }[] = [
  { value: 'none', label: 'No arrowhead', icon: Minus },
  { value: 'end', label: 'Arrow at the end', icon: MoveRight },
  { value: 'both', label: 'Arrows at both ends', icon: MoveHorizontal },
]

const ALIGN: { mode: AlignMode; label: string; icon: LucideIcon }[] = [
  { mode: 'left', label: 'Align left', icon: AlignStartVertical },
  { mode: 'center', label: 'Align centers', icon: AlignCenterVertical },
  { mode: 'right', label: 'Align right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { mode: 'middle', label: 'Align middles', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
]

const DISTRIBUTE: { axis: 'x' | 'y'; label: string; icon: LucideIcon }[] = [
  { axis: 'x', label: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter },
  { axis: 'y', label: 'Distribute vertically', icon: AlignVerticalDistributeCenter },
]

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string; icon: LucideIcon }[]
  value: T | null
  onChange(value: T): void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(({ value: v, label: l, icon: Icon }) => (
        <button key={v} type="button" aria-label={l} title={l} aria-pressed={value === v} onClick={() => onChange(v)}>
          <Icon size={16} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  )
}

const same = <T,>(values: T[]): T | null => (new Set(values).size === 1 ? values[0] : null)

/** Actions for the current selection: colour, shape or line style, order, duplicate, delete. */
export function ContextBar({ board, selected, position, onDuplicate, onDelete, onEditText }: ContextBarProps) {
  if (selected.length === 0) return null
  const types = new Set(selected.map((obj) => obj.type))
  const onlyType = types.size === 1 ? selected[0].type : null
  const palette = onlyType && onlyType in PALETTES ? PALETTES[onlyType as keyof typeof PALETTES] : null
  const currentColor = same(selected.map((obj) => ('color' in obj ? obj.color : '')))
  const shapes = selected.filter((obj) => obj.type === 'shape')
  const connectors = selected.filter((obj): obj is ConnectorObject => obj.type === 'connector')
  const ids = selected.map((obj) => obj.id)

  const change = (patches: { id: string; patch: ObjectPatch }[]) => {
    board.checkpoint()
    board.updateMany(patches)
    board.checkpoint()
  }
  const recolor = (color: string) => change(ids.map((id) => ({ id, patch: { color } })))
  const reshape = (kind: ShapeKind) => change(shapes.map((obj) => ({ id: obj.id, patch: { kind } })))
  const lookup = (id: string) => board.get(id)
  const placed = placedObjects(selected, lookup)
  const arrange = (moves: Map<string, Point>) => change(movePatches(moves, board.getSnapshot().ordered, lookup))

  return (
    <div className="panel context-bar" role="toolbar" aria-label="Selection" style={{ left: position.x, top: position.y }}>
      <span className="context-count">{selected.length === 1 ? labelFor(selected[0]) : `${selected.length} selected`}</span>
      {onlyType === 'shape' && <ShapeKindPicker compact value={same(shapes.map((obj) => obj.kind))} onChange={reshape} />}
      {onlyType === 'connector' && (
        <>
          <Choice
            label="Line style"
            options={CONNECTOR_STYLES}
            value={same(connectors.map((c) => c.style ?? 'straight'))}
            onChange={(style) => change(connectors.map((c) => ({ id: c.id, patch: { style } })))}
          />
          <Choice
            label="Arrowheads"
            options={ARROWS}
            value={same(connectors.map((c) => c.arrows ?? 'end'))}
            onChange={(arrows) => change(connectors.map((c) => ({ id: c.id, patch: { arrows } })))}
          />
          {connectors.length === 1 && (
            <button type="button" className="icon-button" aria-label="Edit label" title="Label (Enter)" onClick={() => onEditText(connectors[0].id)}>
              <Type size={18} strokeWidth={1.75} />
            </button>
          )}
        </>
      )}
      {palette && <Swatches colors={palette} value={currentColor} onChange={recolor} />}
      {placed.length >= 2 && (
        <MenuButton label="Align" icon={<AlignStartVertical size={18} strokeWidth={1.75} />}>
          {() => (
            <div className="align-menu">
              <div className="align-grid" role="group" aria-label="Align">
                {ALIGN.map(({ mode, label, icon: Icon }) => (
                  <button key={mode} type="button" className="icon-button" aria-label={label} title={label} onClick={() => arrange(alignMoves(placed, mode))}>
                    <Icon size={18} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
              <div className="align-grid" role="group" aria-label="Distribute">
                {DISTRIBUTE.map(({ axis, label, icon: Icon }) => (
                  <button
                    key={axis}
                    type="button"
                    className="icon-button"
                    aria-label={label}
                    title={placed.length < 3 ? `${label} (select 3 or more)` : label}
                    disabled={placed.length < 3}
                    onClick={() => arrange(distributeMoves(placed, axis))}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </MenuButton>
      )}
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
    case 'image':
      return 'Image'
  }
}
