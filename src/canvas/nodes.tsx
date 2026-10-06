import { memo, useSyncExternalStore } from 'react'
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Label, Line, Rect, Shape, Tag, Text } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import { ACCENT, FONT_FAMILY, INK, LINE_HEIGHT, textColorOn } from '../model/palette'
import {
  STAMP_RADIUS,
  STICKY_PADDING,
  fitFontSize,
  stickyTextBox,
  textObjectHeight,
} from '../model/geometry'
import type { ConnectorRoute } from '../model/geometry'
import { cylinderCap, labelBox, pillRadius, shapeOutline } from '../model/shapes'
import type {
  ArrowHeads,
  ImageObject,
  PenObject,
  SectionObject,
  ShapeKind,
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

function drawCylinder(ctx: Context, shape: KonvaShape) {
  const w = shape.width()
  const h = shape.height()
  const rx = w / 2
  const ry = cylinderCap(w, h) / 2
  ctx.beginPath()
  ctx.moveTo(0, ry)
  ctx.ellipse(rx, ry, rx, ry, 0, Math.PI, 2 * Math.PI)
  ctx.lineTo(w, h - ry)
  ctx.ellipse(rx, h - ry, rx, ry, 0, 0, Math.PI)
  ctx.closePath()
  ctx.fillStrokeShape(shape)
  // The near half of the top rim.
  ctx.beginPath()
  ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI)
  ctx.strokeShape(shape)
}

interface ShapeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  perfectDrawEnabled: boolean
}

function ShapeBody({ kind, w, h, style }: { kind: ShapeKind; w: number; h: number; style: ShapeStyle }) {
  switch (kind) {
    case 'rect':
      return <Rect width={w} height={h} cornerRadius={8} {...style} />
    case 'pill':
      return <Rect width={w} height={h} cornerRadius={pillRadius(w, h)} {...style} />
    case 'ellipse':
      return <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...style} />
    case 'cylinder':
      return <Shape width={w} height={h} sceneFunc={drawCylinder} {...style} />
    default:
      return <Line points={shapeOutline(kind, w, h) ?? []} closed lineJoin="round" {...style} />
  }
}

export const ShapeNode = memo(function ShapeNode({ obj, draggable, editing, lowDetail, handlers }: NodeProps<ShapeObject>) {
  const stroke = obj.color === '#ffffff' ? 'rgba(29,29,27,0.55)' : 'rgba(29,29,27,0.25)'
  const style = { fill: obj.color, stroke, strokeWidth: 1.5, perfectDrawEnabled: false }
  const label = labelBox(obj.kind, obj.w, obj.h)
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      <ShapeBody kind={obj.kind} w={obj.w} h={obj.h} style={style} />
      {!editing && !lowDetail && obj.text && (
        <Text
          x={label.x}
          y={label.y}
          width={label.w}
          height={label.h}
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

export const LABEL_FONT_SIZE = 14
const LABEL_PAD_X = 8
const LABEL_PAD_Y = 4
let measuring: CanvasRenderingContext2D | null = null

/** Size of a connector label's pill, text plus padding. */
export function labelSize(text: string): { w: number; h: number } {
  measuring ??= document.createElement('canvas').getContext('2d')
  const lines = text.split('\n')
  let width = 0
  if (measuring) {
    measuring.font = `${LABEL_FONT_SIZE}px ${FONT_FAMILY}`
    for (const line of lines) width = Math.max(width, measuring.measureText(line).width)
  } else {
    width = Math.max(...lines.map((line) => line.length)) * LABEL_FONT_SIZE * 0.56
  }
  return { w: Math.ceil(width) + 2 * LABEL_PAD_X, h: lines.length * LABEL_FONT_SIZE * LINE_HEIGHT + 2 * LABEL_PAD_Y }
}

type ImageStatus = 'loading' | 'ready' | 'failed'

interface ImageEntry {
  image: HTMLImageElement
  status: ImageStatus
  listeners: Set<() => void>
  subscribe(listener: () => void): () => void
  getStatus(): ImageStatus
}

const images = new Map<string, ImageEntry>()

/** Each image loads once, however many objects show it. */
function imageEntry(src: string): ImageEntry {
  let entry = images.get(src)
  if (entry) return entry
  const image = new window.Image()
  const created: ImageEntry = {
    image,
    status: 'loading',
    listeners: new Set(),
    subscribe(listener) {
      created.listeners.add(listener)
      return () => created.listeners.delete(listener)
    },
    getStatus: () => created.status,
  }
  const settle = (status: ImageStatus) => {
    created.status = status
    created.listeners.forEach((listener) => listener())
  }
  image.onload = () => settle('ready')
  image.onerror = () => settle('failed')
  image.src = src
  images.set(src, created)
  entry = created
  return entry
}

export const ImageNode = memo(function ImageNode({ obj, draggable, handlers }: NodeProps<ImageObject>) {
  const entry = imageEntry(obj.src)
  const status = useSyncExternalStore(entry.subscribe, entry.getStatus)
  return (
    <Group {...groupProps(obj, draggable, handlers)}>
      {status === 'ready' ? (
        <KonvaImage image={entry.image} width={obj.w} height={obj.h} perfectDrawEnabled={false} />
      ) : (
        <>
          <Rect width={obj.w} height={obj.h} fill="#ecece8" stroke="rgba(29,29,27,0.18)" strokeWidth={1} dash={[6, 4]} cornerRadius={4} />
          <Text
            width={obj.w}
            height={obj.h}
            align="center"
            verticalAlign="middle"
            padding={8}
            text={status === 'failed' ? 'Image unavailable' : 'Loading image…'}
            fontSize={13}
            fontFamily={FONT_FAMILY}
            fill="#8a8a83"
            listening={false}
          />
        </>
      )}
    </Group>
  )
})

interface ConnectorNodeProps {
  id: string
  route: ConnectorRoute
  color: string
  arrows: ArrowHeads
  label: string
  selected: boolean
  /** Hide the label while it is being edited in the overlay. */
  editing: boolean
  handlers: NodeHandlers
}

export const ConnectorNode = memo(function ConnectorNode({ id, route, color, arrows, label, selected, editing, handlers }: ConnectorNodeProps) {
  const stroke = selected ? ACCENT : color
  const text = label.trim()
  const size = text && !editing ? labelSize(text) : null
  return (
    <Group
      id={id}
      name="object connector"
      onPointerDown={(e) => handlers.pointerDown(id, e)}
      onDblClick={() => handlers.dblClick(id)}
      onDblTap={() => handlers.dblClick(id)}
    >
      <Arrow
        points={route.points}
        bezier={route.bezier}
        stroke={stroke}
        fill={stroke}
        strokeWidth={2}
        pointerLength={11}
        pointerWidth={11}
        pointerAtEnding={arrows !== 'none'}
        pointerAtBeginning={arrows === 'both'}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={16}
        perfectDrawEnabled={false}
      />
      {size && (
        <Group x={route.mid.x - size.w / 2} y={route.mid.y - size.h / 2}>
          <Rect width={size.w} height={size.h} fill="#ffffff" stroke={selected ? ACCENT : 'rgba(29,29,27,0.2)'} strokeWidth={1} cornerRadius={6} />
          <Text
            x={LABEL_PAD_X}
            y={LABEL_PAD_Y}
            text={text}
            fontSize={LABEL_FONT_SIZE}
            fontFamily={FONT_FAMILY}
            lineHeight={LINE_HEIGHT}
            fill={INK}
            listening={false}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </Group>
  )
})
