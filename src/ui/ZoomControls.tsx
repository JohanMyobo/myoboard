import { Maximize, Minus, Plus } from 'lucide-react'

interface ZoomControlsProps {
  scale: number
  onZoomIn(): void
  onZoomOut(): void
  onReset(): void
  onFit(): void
}

export function ZoomControls({ scale, onZoomIn, onZoomOut, onReset, onFit }: ZoomControlsProps) {
  return (
    <div className="panel zoom-controls" role="group" aria-label="Zoom">
      <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out (Ctrl/⌘ −)" onClick={onZoomOut}>
        <Minus size={16} strokeWidth={2} />
      </button>
      <button type="button" className="zoom-level" aria-label="Reset zoom to 100%" title="Reset to 100% (Ctrl/⌘ 0)" onClick={onReset}>
        {Math.round(scale * 100)}%
      </button>
      <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in (Ctrl/⌘ +)" onClick={onZoomIn}>
        <Plus size={16} strokeWidth={2} />
      </button>
      <button type="button" className="icon-button" aria-label="Zoom to fit" title="Zoom to fit (Shift 1)" onClick={onFit}>
        <Maximize size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
