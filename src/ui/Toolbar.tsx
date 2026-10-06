import { Frame, Hand, ImagePlus, MousePointer2, PenLine, Shapes, Spline, Stamp, StickyNote, Type } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PEN_COLORS, SHAPE_COLORS, STAMPS, STICKY_COLORS } from '../model/palette'
import type { ShapeKind } from '../model/types'
import { READ_ONLY_TOOLS } from '../tools'
import type { Tool, ToolOptions } from '../tools'
import { CONNECTOR_STYLES } from './ContextBar'
import { ShapeKindPicker, Swatches } from './Swatches'

const TOOLS: { tool: Tool; label: string; shortcut: string; icon: LucideIcon }[] = [
  { tool: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { tool: 'hand', label: 'Hand', shortcut: 'H', icon: Hand },
  { tool: 'sticky', label: 'Sticky note', shortcut: 'S', icon: StickyNote },
  { tool: 'shape', label: 'Shape', shortcut: 'R', icon: Shapes },
  { tool: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { tool: 'pen', label: 'Pen', shortcut: 'P', icon: PenLine },
  { tool: 'connector', label: 'Connector', shortcut: 'C', icon: Spline },
  { tool: 'section', label: 'Section', shortcut: 'F', icon: Frame },
  { tool: 'stamp', label: 'Stamp', shortcut: 'E', icon: Stamp },
]

interface ToolbarProps {
  tool: Tool
  options: ToolOptions
  /** Viewers only get the select and hand tools. */
  readOnly: boolean
  /** Opens the file picker; an image is added rather than drawn, so it is not a tool. */
  onAddImage(): void
  onToolChange(tool: Tool): void
  onOptionsChange(patch: Partial<ToolOptions>): void
}

export function Toolbar({ tool, options, readOnly, onAddImage, onToolChange, onOptionsChange }: ToolbarProps) {
  const tools = readOnly ? TOOLS.filter(({ tool: t }) => READ_ONLY_TOOLS.has(t)) : TOOLS
  return (
    <div className="toolbar-dock">
      <nav className="panel toolbar" aria-label="Tools">
        {tools.map(({ tool: t, label, shortcut, icon: Icon }) => (
          <button
            key={t}
            type="button"
            className="tool-button"
            aria-label={label}
            aria-pressed={tool === t}
            title={`${label} (${shortcut})`}
            onClick={() => onToolChange(t)}
          >
            <Icon size={20} strokeWidth={1.75} />
          </button>
        ))}
        {!readOnly && (
          <button type="button" className="tool-button" aria-label="Image" title="Image (I)" onClick={onAddImage}>
            <ImagePlus size={20} strokeWidth={1.75} />
          </button>
        )}
      </nav>
      <ToolOptionsPanel tool={tool} options={options} onOptionsChange={onOptionsChange} />
    </div>
  )
}

function ToolOptionsPanel({ tool, options, onOptionsChange }: Pick<ToolbarProps, 'tool' | 'options' | 'onOptionsChange'>) {
  switch (tool) {
    case 'sticky':
      return (
        <div className="panel tool-options" role="group" aria-label="Sticky note colour">
          <Swatches colors={STICKY_COLORS} value={options.stickyColor} onChange={(stickyColor) => onOptionsChange({ stickyColor })} />
        </div>
      )
    case 'shape':
      return (
        <div className="panel tool-options" role="group" aria-label="Shape options">
          <ShapeKindPicker value={options.shapeKind} onChange={(shapeKind: ShapeKind) => onOptionsChange({ shapeKind })} />
          <Swatches colors={SHAPE_COLORS} value={options.shapeColor} onChange={(shapeColor) => onOptionsChange({ shapeColor })} />
        </div>
      )
    case 'pen':
      return (
        <div className="panel tool-options" role="group" aria-label="Pen options">
          <Swatches colors={PEN_COLORS} value={options.penColor} onChange={(penColor) => onOptionsChange({ penColor })} />
          <div className="segmented" role="group" aria-label="Pen width">
            {[2, 4, 8].map((width) => (
              <button
                key={width}
                type="button"
                aria-pressed={options.penWidth === width}
                aria-label={`${width}px`}
                onClick={() => onOptionsChange({ penWidth: width })}
              >
                <span className="pen-dot" style={{ width: width + 2, height: width + 2 }} />
              </button>
            ))}
          </div>
        </div>
      )
    case 'connector':
      return (
        <div className="panel tool-options" role="group" aria-label="Connector options">
          <div className="segmented" role="group" aria-label="Line style">
            {CONNECTOR_STYLES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={options.connectorStyle === value}
                onClick={() => onOptionsChange({ connectorStyle: value })}
              >
                <Icon size={16} strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </div>
      )
    case 'stamp':
      return (
        <div className="panel tool-options stamps" role="group" aria-label="Stamp">
          {STAMPS.map((stamp) => (
            <button
              key={stamp}
              type="button"
              className="stamp-choice"
              aria-pressed={options.stamp === stamp}
              aria-label={`Stamp ${stamp}`}
              onClick={() => onOptionsChange({ stamp })}
            >
              {stamp}
            </button>
          ))}
        </div>
      )
    default:
      return null
  }
}
