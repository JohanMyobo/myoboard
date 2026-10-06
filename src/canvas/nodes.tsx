import { memo } from 'react'
import { Arrow, Circle, Ellipse, Group, Label, Line, Rect, Shape, Tag, Text } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { KonvaEventObject } from 'konva/lib/Node'
import { ACCENT, FONT_FAMILY, INK, LINE_HEIGHT, textColorOn } from '../model/palette'
import {
  STAMP_RADIUS,
  STICKY_PADDING,
  fitFontSize,
  stickyTextBox,
  textObjectHeight,
} from '../model/geometry'
import type {
  PenObject,
  SectionObject,
  ShapeObject,
  StampObject,
  StickyObject,
  TextObject,
} from '../model/types'

export const SHAPE_FONT_SIZE = 16
export const SHAPE_PADDING = 12
export const SECTION_TITLE_SIZE = 14
export const SECTION_TITLE_INSET = 10

/** Callbacks shared by every node; one stable object, so memoised nodes stay cached. */
export interface NodeHandlers {
  pointerDown(id: string, e: KonvaEventObject<PointerEvent>): void
  dragStart(id: string, e: KonvaEventObject<DragEvent>): void
  dragMove(id: string, e: KonvaEventObject<DragEvent>): void
  dragEnd(id: string, e: KonvaEventObject<DragEvent>): void
  dblClick(id: string): void
}

interface NodeProps<T> {
  obj: T
  draggable: boolean
  /** Hide the text while it is being edited in the overlay. */
  editing: boolean
  /** Zoomed too far out to read: skip text, which is the expensive part to draw. */
  lowDetail: boolean
  handlers: NodeHandlers
}

function groupProps(obj: { id: string; x: number; y: number }, draggable: boolean, handlers: NodeHandlers) {
  return {
    id: obj.id,
    name: 'object',
    x: obj.x,
    y: obj.y,
    draggable,
    onPointerDown: (e: KonvaEventObject<PointerEvent>) => handlers.pointerDown(obj.id, e),
    onDragStart: (e: KonvaEventObject<DragEvent>) => handlers.dragStart(obj.id, e),
    onDragMove: (e: KonvaEventObject<DragEvent>) => handlers.dragMove(obj.id, e),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => handlers.dragEnd(obj.id, e),
    onDblClick: () => handlers.dblClick(obj.id),
    onDblTap: () => handlers.dblClick(obj.id),
  }
}

// A canvas shadow blur under every sticky note costs about 100 ms a frame with
// a few hundred notes on screen (Chrome on macOS). So the shadow is blurred
// once, into a bitmap that is stretched under each note: nearly free to draw.
const SHADOW_BASE = 200
const SHADOW_PAD = 24
const SHADOW_RES = 2
let stickyShadow: HTMLCanvasElement | undefined

function stickyShadowImage(): HTMLCanvasElement {
  if (stickyShadow) return stickyShadow
  const size = (SHADOW_BASE + SHADOW_PAD * 2) * SHADOW_RES
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Draw the note off the canvas and offset its shadow back in, so only the
  // shadow lands. Shadow settings are in device pixels, hence SHADOW_RES.
  ctx.shadowColor = 'rgba(29,29,27,0.14)'
  ctx.shadowBlur = 10 * SHADOW_RES
  ctx.shadowOffsetX = size
  ctx.shadowOffsetY = 3 * SHADOW_RES
  ctx.beginPath()
  ctx.roundRect(SHADOW_PAD * SHADOW_RES - size, SHADOW_PAD * SHADOW_RES, SHADOW_BASE * SHADOW_RES, SHADOW_BASE * SHADOW_RES, 4 * SHADOW_RES)
  ctx.fill()
  stickyShadow = canvas
  return canvas
}

function drawStickyShadow(ctx: Context, w: number, h: number) {
  const image = stickyShadowImage()
  const sx = w / SHADOW_BASE
  const sy = h / SHADOW_BASE
  ctx.drawImage(image, -SHADOW_PAD * sx, -SHADOW_PAD * sy, (image.width / SHADOW_RES) * sx, (image.height / SHADOW_RES) * sy)
}

export const StickyNode = memo(function StickyNode({ obj, draggable, editing, lowDetail, handlers }: NodeProps<StickyObject>) {
  const box = stickyTextBox(obj.w, obj.h)
  const fontSize = fitFontSize(obj.text, box.width, box.height)
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      {/* No size, so the resize handles keep fitting the note, not its shadow. */}
      {!lowDetail && <Shape listening={false} sceneFunc={(ctx) => drawStickyShadow(ctx, obj.w, obj.h)} />}
      <Rect width={obj.w} height={obj.h} fill={obj.color} cornerRadius={4} perfectDrawEnabled={false} />
      {!editing && !lowDetail && (
        <Text
          x={STICKY_PADDING}
          y={STICKY_PADDING}
          width={box.width}
          height={box.height}
          text={obj.text}
          fontSize={fontSize}
          fontFamily={FONT_FAMILY}
          lineHeight={LINE_HEIGHT}
          fill={INK}
          wrap="word"
          ellipsis
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {obj.author && !lowDetail && (
        <Text
          x={STICKY_PADDING}
          y={obj.h - STICKY_PADDING - 12}
          width={box.width}
          text={obj.author}
          fontSize={11}
          fontFamily={FONT_FAMILY}
          fill="rgba(29,29,27,0.55)"
          wrap="none"
          ellipsis
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
})

export const ShapeNode = memo(function ShapeNode({ obj, draggable, editing, lowDetail, handlers }: NodeProps<ShapeObject>) {
  const stroke = obj.color === '#ffffff' ? 'rgba(29,29,27,0.55)' : 'rgba(29,29,27,0.25)'
  const common = { fill: obj.color, stroke, strokeWidth: 1.5, perfectDrawEnabled: false }
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      {obj.kind === 'rect' && <Rect width={obj.w} height={obj.h} cornerRadius={8} {...common} />}
      {obj.kind === 'ellipse' && (
        <Ellipse x={obj.w / 2} y={obj.h / 2} radiusX={obj.w / 2} radiusY={obj.h / 2} {...common} />
      )}
      {obj.kind === 'diamond' && (
        <Line points={[obj.w / 2, 0, obj.w, obj.h / 2, obj.w / 2, obj.h, 0, obj.h / 2]} closed {...common} />
      )}
      {!editing && !lowDetail && obj.text && (
        <Text
          width={obj.w}
          height={obj.h}
          padding={SHAPE_PADDING}
          text={obj.text}
          align="center"
          verticalAlign="middle"
          fontSize={SHAPE_FONT_SIZE}
          fontFamily={FONT_FAMILY}
          lineHeight={LINE_HEIGHT}
          fill={textColorOn(obj.color)}
          wrap="word"
          ellipsis
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
})

export const TextNode = memo(function TextNode({ obj, draggable, editing, lowDetail, handlers }: NodeProps<TextObject>) {
  const height = textObjectHeight(obj.text, obj.w, obj.fontSize)
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      {editing || lowDetail ? (
        <Rect width={obj.w} height={height} fill={lowDetail ? 'rgba(29,29,27,0.14)' : undefined} cornerRadius={4} />
      ) : (
        <Text
          width={obj.w}
          text={obj.text || ' '}
          fontSize={obj.fontSize}
          fontFamily={FONT_FAMILY}
          lineHeight={LINE_HEIGHT}
          fill={obj.color}
          wrap="word"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
})

export const PenNode = memo(function PenNode({ obj, draggable, handlers }: NodeProps<PenObject>) {
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      <Line
        points={obj.points}
        stroke={obj.color}
        strokeWidth={obj.width}
        lineCap="round"
        lineJoin="round"
        tension={0.3}
        hitStrokeWidth={Math.max(14, obj.width)}
        perfectDrawEnabled={false}
      />
    </Group>
  )
})

/**
 * A section's body lets clicks through (so you can draw a selection inside
 * it); its title tag is the handle that selects and moves it.
 */
export const SectionNode = memo(function SectionNode({ obj, draggable, editing, handlers }: NodeProps<SectionObject>) {
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      <Rect
        width={obj.w}
        height={obj.h}
        fill={obj.color}
        cornerRadius={10}
        stroke="rgba(29,29,27,0.16)"
        strokeWidth={1}
        listening={false}
        perfectDrawEnabled={false}
      />
      <Label x={SECTION_TITLE_INSET} y={SECTION_TITLE_INSET} opacity={editing ? 0 : 1}>
        <Tag fill="rgba(255,255,255,0.9)" stroke="rgba(29,29,27,0.12)" strokeWidth={1} cornerRadius={6} />
        <Text
          text={obj.title || 'Section'}
          padding={6}
          fontSize={SECTION_TITLE_SIZE}
          fontStyle="600"
          fontFamily={FONT_FAMILY}
          fill={INK}
          perfectDrawEnabled={false}
        />
      </Label>
    </Group>
  )
})

export const StampNode = memo(function StampNode({ obj, draggable, handlers }: NodeProps<StampObject>) {
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      <Circle
        radius={STAMP_RADIUS}
        fill="#ffffff"
        stroke={obj.color}
        strokeWidth={2.5}
        shadowColor="#1d1d1b"
        shadowOpacity={0.12}
        shadowBlur={6}
        shadowOffsetY={2}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      <Text
        x={-STAMP_RADIUS}
        y={-STAMP_RADIUS + 1}
        width={STAMP_RADIUS * 2}
        height={STAMP_RADIUS * 2}
        text={obj.emoji}
        fontSize={22}
        align="center"
        verticalAlign="middle"
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  )
})

interface ConnectorNodeProps {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  selected: boolean
  handlers: NodeHandlers
}

export const ConnectorNode = memo(function ConnectorNode({ id, x1, y1, x2, y2, color, selected, handlers }: ConnectorNodeProps) {
  const stroke = selected ? ACCENT : color
  return (
    <Arrow
      id={id}
      name="object connector"
      points={[x1, y1, x2, y2]}
      stroke={stroke}
      fill={stroke}
      strokeWidth={2}
      pointerLength={11}
      pointerWidth={11}
      lineCap="round"
      hitStrokeWidth={16}
      perfectDrawEnabled={false}
      onPointerDown={(e) => handlers.pointerDown(id, e)}
    />
  )
})
