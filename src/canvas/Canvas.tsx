import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type Konva from 'konva'
import { Arrow, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { ACCENT, FONT_FAMILY, INK, SECTION_COLORS } from '../model/palette'
import {
  boxFromPoints,
  connectorEnds,
  connectorRoute,
  contains,
  intersects,
  normalizeBox,
  objectBounds,
  objectsInside,
  topmostAt,
} from '../model/geometry'
import type { Box, ConnectorRoute, Point } from '../model/geometry'
import { isAttached } from '../model/types'
import type { BoardObject, ConnectorObject, Endpoint, SectionObject, StampObject } from '../model/types'
import type { BoardSnapshot } from '../model/board'
import type { BoardSession } from '../sync/session'
import type { Identity } from '../sync/identity'
import type { Peer } from '../hooks'
import { DEFAULT_SIZES } from '../tools'
import type { Tool, ToolOptions } from '../tools'
import { drawRegion, toWorld } from './camera'
import type { Camera } from './camera'
import { ConnectorNode, ImageNode, PenNode, SectionNode, ShapeNode, StampNode, StickyNode, TextNode } from './nodes'
import type { NodeHandlers } from './nodes'

/** An interaction in progress, drawn in the overlay layer until it is committed. */
type Draft =
  /** A click that places an object; it is created on release, so its editor keeps focus. */
  | { kind: 'place'; tool: 'sticky' | 'text' | 'stamp'; at: Point }
  | { kind: 'marquee'; start: Point; end: Point; base: string[] }
  | { kind: 'shape' | 'section'; start: Point; end: Point }
  | { kind: 'pen'; origin: Point; points: number[] }
  | { kind: 'connector'; from: Endpoint; end: Point; hoverId: string | null }

interface DragState {
  anchorId: string
  anchorStart: Point
  /** Where every moving object started: the selection plus what selected sections hold. */
  start: Map<string, Point>
  /** Selected connectors, whose free ends move with the drag. */
  connectors: Map<string, { from: Endpoint; to: Endpoint }>
  pending: Point | null
  frame: number
}

export interface CanvasProps {
  session: BoardSession
  snapshot: BoardSnapshot
  identity: Identity
  size: { width: number; height: number }
  camera: Camera
  setCamera: Dispatch<SetStateAction<Camera>>
  tool: Tool
  setTool(tool: Tool): void
  options: ToolOptions
  selection: string[]
  setSelection(ids: string[]): void
  editingId: string | null
  setEditingId(id: string | null): void
  /** Space is held: drag to pan whatever the tool. */
  panKey: boolean
  setPanning(panning: boolean): void
  /** Other people's selections, outlined in their colour. */
  peers: Peer[]
  stageRef: RefObject<Konva.Stage | null>
  overlayRef: RefObject<Konva.Layer | null>
  /** Draw every object in full detail (for exports), not just what is near the screen. */
  fullRender: boolean
  /** A viewer: select and look around, but change nothing. */
  readOnly: boolean
  /** The comment tool was clicked here, possibly on an object. */
  onCommentAt(at: { x: number; y: number; on: string | null }): void
  /** Set while a vote runs: clicking an object votes for it (retract: take a vote back). */
  onVote?: (id: string, retract: boolean) => void
}

const RESIZABLE: ReadonlySet<BoardObject['type']> = new Set(['sticky', 'shape', 'section', 'text', 'image'])
/** Resized from the corners, keeping their proportions. */
const KEEP_RATIO: ReadonlySet<BoardObject['type']> = new Set(['sticky', 'image'])
/** What Enter or a double-click edits: text, a section's title, a connector's label. */
export const EDITABLE: ReadonlySet<BoardObject['type']> = new Set(['sticky', 'shape', 'section', 'text', 'connector'])
const CURSOR_THROTTLE_MS = 40
const MIN_SIZE = 24
/** Below this zoom, text is too small to read and is not drawn. */
const LOW_DETAIL_SCALE = 0.25

const unique = (ids: string[]) => [...new Set(ids)]
const round1 = (n: number) => Math.round(n * 10) / 10

function anchorsFor(obj: BoardObject | null): string[] {
  if (!obj) return []
  if (obj.type === 'text') return ['middle-left', 'middle-right']
  if (KEEP_RATIO.has(obj.type)) return ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right']
}

export function Canvas(props: CanvasProps) {
  const { session, snapshot, size, camera, setCamera, tool, selection, editingId, panKey, peers, stageRef, overlayRef, fullRender, readOnly } = props
  const { board, awareness } = session

  const [draft, setDraftState] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  // Event handlers are created once; they read the latest props from here.
  const latest = useRef(props)
  latest.current = props

  const lookup = (id: string) => latest.current.snapshot.byId.get(id)

  const setDraft = (next: Draft | null) => {
    draftRef.current = next
    setDraftState(next)
  }

  /** Updates the selection now, so a drag starting in the same gesture sees it. */
  const selectNow = (ids: string[]) => {
    selectionRef.current = ids
    latest.current.setSelection(ids)
  }

  const screenPoint = (evt: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current?.container().getBoundingClientRect()
    return rect ? { x: evt.clientX - rect.left, y: evt.clientY - rect.top } : { x: evt.clientX, y: evt.clientY }
  }
  const worldPoint = (evt: { clientX: number; clientY: number }) => toWorld(latest.current.camera, screenPoint(evt))

  /** Follows a pointer gesture on the window, so it keeps working outside the canvas. */
  const track = (onMove: (evt: PointerEvent) => void, onUp: (evt: PointerEvent) => void) => {
    const up = (evt: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onUp(evt)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const beginPan = (evt: PointerEvent) => {
    const start = screenPoint(evt)
    const startCamera = latest.current.camera
    latest.current.setPanning(true)
    track(
      (e) => {
        const p = screenPoint(e)
        setCamera({ ...startCamera, x: startCamera.x + p.x - start.x, y: startCamera.y + p.y - start.y })
      },
      () => latest.current.setPanning(false),
    )
  }

  const advanceDraft = (d: Draft, world: Point): Draft => {
    switch (d.kind) {
      case 'place':
        return d
      case 'marquee': {
        const area = normalizeBox(d.start, world)
        const { snapshot: snap, camera: cam } = latest.current
        if (area.w * cam.scale > 3 || area.h * cam.scale > 3) {
          const hits = snap.ordered.filter((obj) => {
            const box = objectBounds(obj, lookup)
            if (!box) return false
            // Sections only when fully inside, so starting a drag in one does not grab it.
            return obj.type === 'section' ? contains(area, box) : intersects(area, box)
          })
          selectNow(unique([...d.base, ...hits.map((obj) => obj.id)]))
        }
        return { ...d, end: world }
      }
      case 'shape':
      case 'section':
        return { ...d, end: world }
      case 'pen': {
        const x = world.x - d.origin.x
        const y = world.y - d.origin.y
        const n = d.points.length
        if (Math.hypot(x - d.points[n - 2], y - d.points[n - 1]) < 2 / latest.current.camera.scale) return d
        return { ...d, points: [...d.points, x, y] }
      }
      case 'connector': {
        const exclude = isAttached(d.from) ? new Set([d.from.id]) : undefined
        const hover = topmostAt(world, latest.current.snapshot.ordered, { exclude })
        return { ...d, end: world, hoverId: hover?.id ?? null }
      }
    }
  }

  const finishDraft = (d: Draft) => {
    const { camera: cam, options, identity, snapshot: snap, setTool, setEditingId } = latest.current
    const author = identity.name
    switch (d.kind) {
      case 'place':
        if (d.tool === 'sticky') {
          const side = DEFAULT_SIZES.sticky
          const id = board.create({
            type: 'sticky',
            x: round1(d.at.x - side / 2),
            y: round1(d.at.y - side / 2),
            w: side,
            h: side,
            color: options.stickyColor,
            text: '',
            author,
          })
          board.checkpoint()
          selectNow([id])
          setTool('select')
          setEditingId(id)
        } else if (d.tool === 'text') {
          const fontSize = DEFAULT_SIZES.textFontSize
          const id = board.create({
            type: 'text',
            x: round1(d.at.x),
            y: round1(d.at.y - fontSize * 0.65),
            w: DEFAULT_SIZES.textWidth,
            text: '',
            fontSize,
            color: INK,
            author,
          })
          board.checkpoint()
          selectNow([id])
          setTool('select')
          setEditingId(id)
        } else {
          board.create({ type: 'stamp', x: round1(d.at.x), y: round1(d.at.y), emoji: options.stamp, color: identity.color, author })
          board.checkpoint()
        }
        return
      case 'marquee':
        return
      case 'shape': {
        const area = normalizeBox(d.start, d.end)
        const { w, h } = DEFAULT_SIZES.shape
        const clicked = area.w * cam.scale < 8 && area.h * cam.scale < 8
        const box = clicked
          ? { x: d.start.x - w / 2, y: d.start.y - h / 2, w, h }
          : { ...area, w: Math.max(area.w, MIN_SIZE), h: Math.max(area.h, MIN_SIZE) }
        const id = board.create({ type: 'shape', kind: options.shapeKind, ...box, color: options.shapeColor, text: '', author })
        board.checkpoint()
        selectNow([id])
        setTool('select')
        return
      }
      case 'section': {
        const area = normalizeBox(d.start, d.end)
        const clicked = area.w * cam.scale < 8 && area.h * cam.scale < 8
        const box = clicked
          ? { x: d.start.x, y: d.start.y, ...DEFAULT_SIZES.section }
          : { ...area, w: Math.max(area.w, 120), h: Math.max(area.h, 80) }
        const count = snap.ordered.filter((obj) => obj.type === 'section').length
        const id = board.create({
          type: 'section',
          ...box,
          title: `Section ${count + 1}`,
          color: SECTION_COLORS[0].value,
          author,
        })
        board.checkpoint()
        selectNow([id])
        setTool('select')
        return
      }
      case 'pen': {
        const points = d.points.length >= 4 ? d.points : [0, 0, 0.5, 0.5]
        board.create({
          type: 'pen',
          x: round1(d.origin.x),
          y: round1(d.origin.y),
          points: points.map(round1),
          color: options.penColor,
          width: options.penWidth,
          author,
        })
        board.checkpoint()
        return
      }
      case 'connector': {
        const to: Endpoint = d.hoverId ? { id: d.hoverId } : { x: round1(d.end.x), y: round1(d.end.y) }
        if (isAttached(d.from) && isAttached(to) && d.from.id === to.id) return
        const ends = connectorEnds({ from: d.from, to }, lookup)
        if (!ends || Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y) < 12 / cam.scale) return
        const id = board.create({ type: 'connector', x: 0, y: 0, from: d.from, to, color: INK, style: options.connectorStyle, author })
        board.checkpoint()
        selectNow([id])
        setTool('select')
        return
      }
    }
  }

  const beginDraft = (initial: Draft) => {
    setDraft(initial)
    track(
      (evt) => {
        const d = draftRef.current
        if (d) setDraft(advanceDraft(d, worldPoint(evt)))
      },
      (evt) => {
        const d = draftRef.current
        setDraft(null)
        if (d) finishDraft(advanceDraft(d, worldPoint(evt)))
      },
    )
  }

  const onStagePointerDown = (e: KonvaEventObject<PointerEvent>) => {
    const evt = e.evt
    const { tool: currentTool, panKey: spaceHeld, camera: cam, snapshot: snap } = latest.current
    if (evt.button === 1 || (evt.button === 0 && (currentTool === 'hand' || spaceHeld))) {
      evt.preventDefault()
      beginPan(evt)
      return
    }
    if (evt.button !== 0) return
    const world = toWorld(cam, screenPoint(evt))
    const onObject = e.target !== e.target.getStage() && !!e.target.findAncestor('.object', true)

    switch (currentTool) {
      case 'select':
        if (onObject) return
        if (!evt.shiftKey) selectNow([])
        beginDraft({ kind: 'marquee', start: world, end: world, base: evt.shiftKey ? selectionRef.current : [] })
        return
      case 'sticky':
      case 'text':
      case 'stamp':
        beginDraft({ kind: 'place', tool: currentTool, at: world })
        return
      case 'shape':
      case 'section':
        beginDraft({ kind: currentTool, start: world, end: world })
        return
      case 'pen':
        beginDraft({ kind: 'pen', origin: world, points: [0, 0] })
        return
      case 'connector': {
        const hit = topmostAt(world, snap.ordered)
        beginDraft({ kind: 'connector', from: hit ? { id: hit.id } : { x: round1(world.x), y: round1(world.y) }, end: world, hoverId: null })
        return
      }
      case 'comment': {
        const target = topmostAt(world, snap.ordered, { includeSections: false })
        latest.current.onCommentAt({ x: world.x, y: world.y, on: target?.id ?? null })
        return
      }
      case 'hand':
        return
    }
  }

  const flushDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    drag.frame = 0
    const delta = drag.pending
    if (!delta) return
    drag.pending = null
    const shift = (endpoint: Endpoint): Endpoint =>
      isAttached(endpoint) ? endpoint : { x: round1(endpoint.x + delta.x), y: round1(endpoint.y + delta.y) }
    board.updateMany([
      ...[...drag.start].map(([id, p]) => ({ id, patch: { x: round1(p.x + delta.x), y: round1(p.y + delta.y) } })),
      ...[...drag.connectors].map(([id, ends]) => ({ id, patch: { from: shift(ends.from), to: shift(ends.to) } })),
    ])
  }

  // Created once: memoised nodes keep the same handlers and skip re-rendering.
  const handlers = useMemo<NodeHandlers>(
    () => ({
      pointerDown(id, e) {
        const { tool: currentTool, panKey: spaceHeld, onVote } = latest.current
        if (currentTool !== 'select' || spaceHeld || e.evt.button !== 0) return
        if (onVote) {
          onVote(id, e.evt.shiftKey)
          return
        }
        const current = selectionRef.current
        if (e.evt.shiftKey) selectNow(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
        else if (!current.includes(id)) selectNow([id])
      },
      dragStart(id) {
        const snap = latest.current.snapshot
        const anchor = snap.byId.get(id)
        if (!anchor) return
        const chosen = selectionRef.current.includes(id) ? selectionRef.current : [id]
        const start = new Map<string, Point>()
        const connectors = new Map<string, { from: Endpoint; to: Endpoint }>()
        for (const sid of chosen) {
          const obj = snap.byId.get(sid)
          if (!obj) continue
          if (obj.type === 'connector') {
            connectors.set(sid, { from: obj.from, to: obj.to })
            continue
          }
          start.set(sid, { x: obj.x, y: obj.y })
          if (obj.type === 'section') {
            for (const inner of objectsInside(objectBounds(obj)!, snap.ordered, lookup)) {
              if (!start.has(inner.id)) start.set(inner.id, { x: inner.x, y: inner.y })
            }
          }
        }
        board.checkpoint()
        dragRef.current = { anchorId: id, anchorStart: { x: anchor.x, y: anchor.y }, start, connectors, pending: null, frame: 0 }
      },
      dragMove(id, e) {
        const drag = dragRef.current
        if (!drag || drag.anchorId !== id) return
        drag.pending = { x: e.target.x() - drag.anchorStart.x, y: e.target.y() - drag.anchorStart.y }
        if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag)
      },
      dragEnd(id, e) {
        const drag = dragRef.current
        if (!drag || drag.anchorId !== id) return
        if (drag.frame) cancelAnimationFrame(drag.frame)
        drag.pending = { x: e.target.x() - drag.anchorStart.x, y: e.target.y() - drag.anchorStart.y }
        flushDrag()
        dragRef.current = null
        board.checkpoint()
      },
      dblClick(id) {
        const obj = latest.current.snapshot.byId.get(id)
        // While voting, quick clicks are votes, not a double-click to edit.
        if (!obj || latest.current.tool !== 'select' || latest.current.readOnly || latest.current.onVote || !EDITABLE.has(obj.type)) return
        selectNow([id])
        latest.current.setEditingId(id)
      },
    }),
    [board],
  )

  // Share where the pointer is, so others see a live cursor. It is tracked
  // over the whole window (panels included) and hidden only when it leaves.
  useEffect(() => {
    const root = document.documentElement
    let last = 0
    let timer = 0
    let pending: Point | null = null
    const send = () => {
      last = performance.now()
      timer = 0
      awareness.setLocalStateField('cursor', pending)
    }
    const onMove = (evt: PointerEvent) => {
      const world = worldPoint(evt)
      pending = { x: Math.round(world.x), y: Math.round(world.y) }
      const wait = CURSOR_THROTTLE_MS - (performance.now() - last)
      if (wait <= 0) send()
      else if (!timer) timer = window.setTimeout(send, wait)
    }
    const onLeave = () => {
      if (timer) clearTimeout(timer)
      timer = 0
      pending = null
      awareness.setLocalStateField('cursor', null)
    }
    window.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      if (timer) clearTimeout(timer)
    }
  }, [awareness, stageRef])

  useEffect(() => {
    awareness.setLocalStateField('selection', selection)
  }, [awareness, selection])

  // The transformer (resize handles) shows for one resizable object at a time.
  const single = selection.length === 1 ? (snapshot.byId.get(selection[0]) ?? null) : null
  const resizable = single && RESIZABLE.has(single.type) && tool === 'select' && !editingId && !draft && !readOnly && !props.onVote ? single : null
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const node = resizable ? stage.findOne(`#${resizable.id}`) : undefined
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [resizable, snapshot, stageRef])

  const onTransformEnd = () => {
    const node = trRef.current?.nodes()[0]
    if (!node) return
    const obj = snapshot.byId.get(node.id())
    if (!obj || !('w' in obj)) return
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const x = round1(node.x())
    const y = round1(node.y())
    const w = round1(Math.max(MIN_SIZE, obj.w * sx))
    board.checkpoint()
    if (obj.type === 'text') board.update(obj.id, { x, y, w })
    else if ('h' in obj) board.update(obj.id, { x, y, w, h: round1(Math.max(MIN_SIZE, obj.h * sy)) })
    board.checkpoint()
  }

  // Only objects near the screen are drawn; selected and edited ones always are.
  const region = drawRegion(camera, size)
  const regionKey = [region.x, region.y, region.w, region.h].map(Math.round).join(',')
  const groups = useMemo(() => {
    const keep = new Set(selection)
    if (editingId) keep.add(editingId)
    const near = (box: Box | null) => fullRender || (box !== null && intersects(region, box))
    const sections: SectionObject[] = []
    const items: BoardObject[] = []
    const connectors: { conn: ConnectorObject; route: ConnectorRoute }[] = []
    const stamps: StampObject[] = []
    for (const obj of snapshot.ordered) {
      if (obj.type === 'connector') {
        const route = connectorRoute(obj, lookup)
        if (!route) continue
        const points = []
        for (let i = 0; i + 1 < route.points.length; i += 2) points.push({ x: route.points[i], y: route.points[i + 1] })
        if (keep.has(obj.id) || near(boxFromPoints(points))) connectors.push({ conn: obj, route })
        continue
      }
      if (!keep.has(obj.id) && !near(objectBounds(obj))) continue
      if (obj.type === 'section') sections.push(obj)
      else if (obj.type === 'stamp') stamps.push(obj)
      else items.push(obj)
    }
    return { sections, items, connectors, stamps }
    // `region` only matters through `regionKey`, which snaps while panning.
  }, [snapshot, regionKey, fullRender, selection, editingId])

  const draggable = tool === 'select' && !panKey && !readOnly && !props.onVote
  const s = camera.scale
  const selected = useMemo(() => new Set(selection), [selection])

  const lowDetail = !fullRender && camera.scale < LOW_DETAIL_SCALE
  const renderObject = (obj: BoardObject) => {
    const common = { draggable, editing: obj.id === editingId, lowDetail, handlers }
    switch (obj.type) {
      case 'sticky':
        return <StickyNode key={obj.id} obj={obj} {...common} />
      case 'shape':
        return <ShapeNode key={obj.id} obj={obj} {...common} />
      case 'text':
        return <TextNode key={obj.id} obj={obj} {...common} />
      case 'pen':
        return <PenNode key={obj.id} obj={obj} {...common} />
      case 'section':
        return <SectionNode key={obj.id} obj={obj} {...common} />
      case 'stamp':
        return <StampNode key={obj.id} obj={obj} {...common} />
      case 'image':
        return <ImageNode key={obj.id} obj={obj} {...common} />
      case 'connector':
        return null
    }
  }

  const outline = (box: Box, key: string, color: string, dashed = false) => (
    <Rect
      key={key}
      x={box.x - 3 / s}
      y={box.y - 3 / s}
      width={box.w + 6 / s}
      height={box.h + 6 / s}
      stroke={color}
      strokeWidth={1.5 / s}
      dash={dashed ? [6 / s, 4 / s] : undefined}
      cornerRadius={4 / s}
      listening={false}
    />
  )

  const draftShape = (() => {
    if (!draft) return null
    switch (draft.kind) {
      case 'place':
        return null
      case 'marquee': {
        const box = normalizeBox(draft.start, draft.end)
        return <Rect {...box} width={box.w} height={box.h} fill="rgba(37,99,235,0.08)" stroke={ACCENT} strokeWidth={1 / s} />
      }
      case 'shape':
      case 'section': {
        const box = normalizeBox(draft.start, draft.end)
        return <Rect {...box} width={box.w} height={box.h} stroke={ACCENT} strokeWidth={1.5 / s} dash={[6 / s, 4 / s]} cornerRadius={draft.kind === 'section' ? 10 : 8} />
      }
      case 'pen':
        return (
          <Line
            x={draft.origin.x}
            y={draft.origin.y}
            points={draft.points}
            stroke={props.options.penColor}
            strokeWidth={props.options.penWidth}
            lineCap="round"
            lineJoin="round"
            tension={0.3}
          />
        )
      case 'connector': {
        const hover = draft.hoverId ? snapshot.byId.get(draft.hoverId) : undefined
        const hoverBox = hover ? objectBounds(hover, lookup) : null
        const to: Endpoint = hover ? { id: hover.id } : draft.end
        const route = connectorRoute({ from: draft.from, to, style: props.options.connectorStyle }, lookup)
        if (!route) return null
        return (
          <>
            {hoverBox && outline(hoverBox, 'hover', ACCENT)}
            <Arrow points={route.points} bezier={route.bezier} stroke={ACCENT} fill={ACCENT} strokeWidth={2} pointerLength={11} pointerWidth={11} dash={[8, 6]} lineJoin="round" />
          </>
        )
      }
    }
  })()

  return (
    <Stage
      ref={stageRef}
      width={size.width}
      height={size.height}
      x={camera.x}
      y={camera.y}
      scaleX={camera.scale}
      scaleY={camera.scale}
      onPointerDown={onStagePointerDown}
      onContextMenu={(e) => e.evt.preventDefault()}
    >
      <Layer>
        {groups.sections.map(renderObject)}
        {groups.items.map(renderObject)}
        {groups.connectors.map(({ conn, route }) => (
          <ConnectorNode
            key={conn.id}
            id={conn.id}
            route={route}
            color={conn.color}
            arrows={conn.arrows ?? 'end'}
            label={conn.label ?? ''}
            selected={selected.has(conn.id)}
            editing={conn.id === editingId}
            handlers={handlers}
          />
        ))}
        {groups.stamps.map(renderObject)}
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          flipEnabled={false}
          ignoreStroke
          keepRatio={resizable ? KEEP_RATIO.has(resizable.type) : false}
          enabledAnchors={anchorsFor(resizable)}
          anchorSize={9}
          anchorCornerRadius={3}
          anchorStroke={ACCENT}
          borderStroke={ACCENT}
          borderStrokeWidth={1.5}
          padding={2}
          boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < MIN_SIZE || Math.abs(newBox.height) < 12 ? oldBox : newBox)}
          onTransformEnd={onTransformEnd}
        />
      </Layer>
      <Layer ref={overlayRef} listening={false}>
        {selection.map((id) => {
          const obj = snapshot.byId.get(id)
          if (!obj || obj.type === 'connector' || obj.id === resizable?.id) return null
          const box = objectBounds(obj, lookup)
          return box ? outline(box, `sel-${id}`, ACCENT) : null
        })}
        {peers.flatMap((peer) =>
          peer.selection.flatMap((id) => {
            const obj = snapshot.byId.get(id)
            const box = obj ? objectBounds(obj, lookup) : null
            if (!box) return []
            return [
              outline(box, `peer-${peer.clientId}-${id}`, peer.user.color, true),
              <Text
                key={`peer-label-${peer.clientId}-${id}`}
                x={box.x - 3 / s}
                y={box.y - 20 / s}
                text={peer.user.name}
                fontSize={11 / s}
                fontFamily={FONT_FAMILY}
                fill={peer.user.color}
              />,
            ]
          }),
        )}
        {draftShape}
      </Layer>
    </Stage>
  )
}
