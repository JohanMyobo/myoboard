import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type Konva from 'konva'
import { flushSync } from 'react-dom'
import { nanoid } from 'nanoid'
import { Canvas, EDITABLE } from './canvas/Canvas'
import { PeerCursors } from './canvas/PeerCursors'
import { TextEditor } from './canvas/TextEditor'
import type { EditableObject } from './canvas/TextEditor'
import { fitBox, zoomAt } from './canvas/camera'
import type { Camera } from './canvas/camera'
import { contentBounds, downloadDataUrl, fileNameFor, renderBoardPng } from './canvas/exportPng'
import { useBoardSnapshot, useConnectionStatus, useElementSize, usePeers } from './hooks'
import { loadIdentity, saveIdentity } from './sync/identity'
import type { Identity } from './sync/identity'
import { openBoardSession } from './sync/session'
import type { BoardSession } from './sync/session'
import { DEFAULT_TOOL_OPTIONS, TOOL_KEYS } from './tools'
import type { Tool, ToolOptions } from './tools'
import { ContextBar } from './ui/ContextBar'
import { Toolbar } from './ui/Toolbar'
import { TopBar } from './ui/TopBar'
import { ZoomControls } from './ui/ZoomControls'

declare global {
  interface Window {
    /** Debug handle on the open board (used by the end-to-end tests). */
    __myoboard?: {
      session: BoardSession
      getCamera(): Camera
      setCamera(camera: Camera): void
      getSelection(): string[]
    }
  }
}

export function BoardScreen({ boardId }: { boardId: string }) {
  const [identity, setIdentity] = useState<Identity>(loadIdentity)
  const [session, setSession] = useState<BoardSession | null>(null)
  const identityRef = useRef(identity)
  identityRef.current = identity

  useEffect(() => {
    const opened = openBoardSession(boardId, identityRef.current)
    setSession(opened)
    return () => {
      opened.destroy()
      setSession(null)
    }
  }, [boardId])

  useEffect(() => {
    session?.awareness.setLocalStateField('user', identity)
  }, [session, identity])

  const renameSelf = () => {
    const name = window.prompt('Your name on this board', identity.name)?.trim()
    if (!name) return
    const next = { ...identity, name: name.slice(0, 40) }
    saveIdentity(next)
    setIdentity(next)
  }

  if (!session) return <div className="loading">Opening board…</div>
  return <BoardView session={session} identity={identity} onRenameSelf={renameSelf} />
}

function gridStyle(camera: Camera): CSSProperties {
  let step = 24 * camera.scale
  while (step < 12) step *= 4
  return { backgroundSize: `${step}px ${step}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }
}

interface BoardViewProps {
  session: BoardSession
  identity: Identity
  onRenameSelf(): void
}

function BoardView({ session, identity, onRenameSelf }: BoardViewProps) {
  const { board } = session
  const snapshot = useBoardSnapshot(board)
  const status = useConnectionStatus(session.provider)
  const peers = usePeers(session.awareness, false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(wrapRef)
  const stageRef = useRef<Konva.Stage | null>(null)
  const overlayRef = useRef<Konva.Layer | null>(null)

  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [tool, setToolState] = useState<Tool>('select')
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_TOOL_OPTIONS)
  const [selection, setSelection] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [panKey, setPanKey] = useState(false)
  const [panning, setPanning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [fullRender, setFullRender] = useState(false)

  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const sizeRef = useRef(size)
  sizeRef.current = size
  const editingRef = useRef(editingId)
  editingRef.current = editingId
  /** Until someone moves around, the view fits the board once its content arrives. */
  const autoFitRef = useRef(true)

  const setCamera: Dispatch<SetStateAction<Camera>> = useCallback((next) => {
    autoFitRef.current = false
    setCameraState(next)
  }, [])

  const setTool = useCallback((next: Tool) => {
    setToolState(next)
    if (next !== 'select') setEditingId(null)
  }, [])

  const flash = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2200)
  }, [])

  // Place the camera once the canvas has a size, then fit the board when its
  // content arrives from the local copy or the server.
  const placedRef = useRef(false)
  useEffect(() => {
    if (placedRef.current || size.width === 0) return
    placedRef.current = true
    const box = contentBounds(board.getSnapshot())
    setCameraState(box ? fitBox(box, size) : { x: size.width / 2, y: size.height / 2, scale: 1 })
  }, [size, board])

  useEffect(() => {
    let active = true
    const fitIfUntouched = () => {
      if (!active || !autoFitRef.current || sizeRef.current.width === 0) return
      const box = contentBounds(board.getSnapshot())
      if (box) setCameraState(fitBox(box, sizeRef.current))
    }
    void session.offline.whenSynced.then(fitIfUntouched)
    const onSync = (synced: boolean) => {
      if (synced) fitIfUntouched()
    }
    session.provider.on('sync', onSync)
    const stop = window.setTimeout(() => (autoFitRef.current = false), 5000)
    return () => {
      active = false
      session.provider.off('sync', onSync)
      clearTimeout(stop)
    }
  }, [session, board])

  // Objects can disappear under us (someone else deleted them).
  useEffect(() => {
    setSelection((current) => {
      const kept = current.filter((id) => snapshot.byId.has(id))
      return kept.length === current.length ? current : kept
    })
    setEditingId((current) => (current && !snapshot.byId.has(current) ? null : current))
  }, [snapshot])

  const zoomAround = useCallback(
    (scaleFor: (scale: number) => number) => {
      const { width, height } = sizeRef.current
      setCamera((cam) => zoomAt(cam, { x: width / 2, y: height / 2 }, scaleFor(cam.scale)))
    },
    [setCamera],
  )

  const fit = useCallback(() => {
    const box = contentBounds(board.getSnapshot())
    const { width, height } = sizeRef.current
    setCamera(box ? fitBox(box, sizeRef.current) : { x: width / 2, y: height / 2, scale: 1 })
  }, [board, setCamera])

  const duplicate = useCallback(() => {
    if (selection.length === 0) return
    board.checkpoint()
    const ids = board.duplicate(selection)
    board.checkpoint()
    setSelection(ids)
  }, [board, selection])

  const remove = useCallback(() => {
    if (selection.length === 0) return
    board.checkpoint()
    board.remove(selection)
    board.checkpoint()
    setSelection([])
  }, [board, selection])

  const exportPng = () => {
    const stage = stageRef.current
    if (!stage) return
    // Mount every object in full detail for the duration of the render.
    flushSync(() => setFullRender(true))
    let url: string | null
    try {
      url = renderBoardPng(stage, overlayRef.current, board.getSnapshot(), cameraRef.current)
    } finally {
      setFullRender(false)
    }
    if (!url) {
      flash('Nothing to export yet')
      return
    }
    downloadDataUrl(url, fileNameFor(snapshot.title))
  }

  const closeEditor = useCallback(() => {
    const current = editingRef.current
    if (!current) return
    const obj = board.get(current)
    if (obj?.type === 'text' && !obj.text.trim()) board.remove([current])
    board.checkpoint()
    setEditingId(null)
  }, [board])

  // Wheel: scroll to pan, Ctrl/⌘ (or a trackpad pinch) to zoom around the pointer.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault()
      const rect = el.getBoundingClientRect()
      const pointer = { x: evt.clientX - rect.left, y: evt.clientY - rect.top }
      const unit = evt.deltaMode === 1 ? 16 : 1
      if (evt.ctrlKey || evt.metaKey) {
        const factor = Math.exp(-evt.deltaY * unit * 0.0025)
        setCamera((cam) => zoomAt(cam, pointer, cam.scale * factor))
      } else {
        const horizontal = evt.shiftKey && evt.deltaX === 0
        const dx = (horizontal ? evt.deltaY : evt.deltaX) * unit
        const dy = (horizontal ? 0 : evt.deltaY) * unit
        setCamera((cam) => ({ ...cam, x: cam.x - dx, y: cam.y - dy }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setCamera])

  // Keyboard shortcuts. Handlers read the latest state through a ref.
  const keyState = useRef({ selection, snapshot, duplicate, remove, fit, zoomAround })
  keyState.current = { selection, snapshot, duplicate, remove, fit, zoomAround }
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      const state = keyState.current
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (e.key === ' ') {
        e.preventDefault()
        setPanKey(true)
        return
      }
      if (mod) {
        if (key === 'z') e.shiftKey ? board.redo() : board.undo()
        else if (key === 'y') board.redo()
        else if (key === 'd') state.duplicate()
        else if (key === 'a') setSelection(state.snapshot.ordered.map((obj) => obj.id))
        else if (e.key === '=' || e.key === '+') state.zoomAround((s) => s * 1.25)
        else if (e.key === '-') state.zoomAround((s) => s / 1.25)
        else if (e.key === '0') state.zoomAround(() => 1)
        else return
        e.preventDefault()
        return
      }
      if (e.altKey) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection.length > 0) {
          e.preventDefault()
          state.remove()
        }
        return
      }
      if (e.key === 'Escape') {
        setSelection([])
        setTool('select')
        return
      }
      if (e.key === 'Enter' && state.selection.length === 1) {
        const obj = state.snapshot.byId.get(state.selection[0])
        if (obj && EDITABLE.has(obj.type)) {
          e.preventDefault()
          setEditingId(obj.id)
        }
        return
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        state.fit()
        return
      }
      if (e.shiftKey) return
      const next = TOOL_KEYS[key]
      if (next) setTool(next)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        if (!typing(e.target)) e.preventDefault()
        setPanKey(false)
      }
    }
    const onBlur = () => setPanKey(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [board, setTool])

  useEffect(() => {
    const handle = {
      session,
      getCamera: () => cameraRef.current,
      setCamera: (next: Camera) => setCamera(next),
      getSelection: () => keyState.current.selection,
    }
    window.__myoboard = handle
    return () => {
      if (window.__myoboard === handle) delete window.__myoboard
    }
  }, [session, setCamera])

  const selectedObjects = useMemo(
    () => selection.flatMap((id) => snapshot.byId.get(id) ?? []),
    [selection, snapshot],
  )
  const editing = editingId ? snapshot.byId.get(editingId) : undefined
  const editingObj = editing && EDITABLE.has(editing.type) ? (editing as EditableObject) : null

  return (
    <div
      className="board"
      data-tool={tool}
      data-pan-ready={panKey || tool === 'hand' ? 'true' : undefined}
      data-panning={panning ? 'true' : undefined}
    >
      <div className="canvas-wrap" ref={wrapRef} style={gridStyle(camera)} onPointerDownCapture={() => (autoFitRef.current = false)}>
        {size.width > 0 && (
          <Canvas
            session={session}
            snapshot={snapshot}
            identity={identity}
            size={size}
            camera={camera}
            setCamera={setCamera}
            tool={tool}
            setTool={setTool}
            options={options}
            selection={selection}
            setSelection={setSelection}
            editingId={editingId}
            setEditingId={setEditingId}
            panKey={panKey}
            setPanning={setPanning}
            peers={peers}
            stageRef={stageRef}
            overlayRef={overlayRef}
            fullRender={fullRender}
          />
        )}
        <PeerCursors awareness={session.awareness} camera={camera} />
        {editingObj && (
          <TextEditor
            key={editingObj.id}
            obj={editingObj}
            camera={camera}
            onChange={(value) =>
              board.update(editingObj.id, editingObj.type === 'section' ? { title: value } : { text: value })
            }
            onClose={closeEditor}
          />
        )}
        {snapshot.ordered.length === 0 && (
          <p className="empty-hint">
            Pick a tool on the left, or press <kbd>S</kbd> and click to add a sticky note.
          </p>
        )}
      </div>

      <TopBar
        title={snapshot.title}
        onRename={(title) => board.setTitle(title)}
        identity={identity}
        onRenameSelf={onRenameSelf}
        peers={peers}
        status={status}
        canUndo={board.canUndo()}
        canRedo={board.canRedo()}
        onUndo={() => board.undo()}
        onRedo={() => board.redo()}
        onExport={exportPng}
        onNewBoard={() => window.location.assign(`/b/${nanoid(10)}`)}
      />
      <Toolbar tool={tool} options={options} onToolChange={setTool} onOptionsChange={(patch) => setOptions((o) => ({ ...o, ...patch }))} />
      {!editingId && <ContextBar board={board} selected={selectedObjects} onDuplicate={duplicate} onDelete={remove} />}
      <ZoomControls
        scale={camera.scale}
        onZoomIn={() => zoomAround((s) => s * 1.25)}
        onZoomOut={() => zoomAround((s) => s / 1.25)}
        onReset={() => zoomAround(() => 1)}
        onFit={fit}
      />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  )
}
