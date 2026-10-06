import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import type Konva from 'konva'
import { flushSync } from 'react-dom'
import { ApiError, api } from './api'
import type { BoardAccess, User } from './api'
import { Canvas, EDITABLE } from './canvas/Canvas'
import { CLIPBOARD_TYPE, boundsOf, copySelection, parsePayload, pasteable, plainText, textToObjects } from './clipboard'
import type { ClipboardPayload } from './clipboard'
import { PeerCursors } from './canvas/PeerCursors'
import { TextEditor } from './canvas/TextEditor'
import type { EditableObject } from './canvas/TextEditor'
import { fitBox, toScreen, toWorld, zoomAt } from './canvas/camera'
import type { Camera } from './canvas/camera'
import { contentBounds, downloadDataUrl, encodeBoard, fileNameFor, renderBoard } from './canvas/exportBoard'
import type { ExportFormat } from './canvas/exportBoard'
import { useBoardSnapshot, useComments, useConnectionStatus, useElementSize, useFacilitation, usePeers } from './hooks'
import { pinPosition } from './model/comments'
import { connectorRoute, objectBounds, unionBoxes } from './model/geometry'
import type { Point } from './model/geometry'
import type { BoardObject, NewObject } from './model/types'
import { navigate } from './router'
import { MessageScreen } from './screens/MessageScreen'
import { syncClock } from './sync/clock'
import type { Identity } from './sync/identity'
import { ACCESS_CHANGED, openBoardSession } from './sync/session'
import { builtInTemplate } from './templates'
import type { BoardSession } from './sync/session'
import { DEFAULT_TOOL_OPTIONS, READ_ONLY_TOOLS, TOOL_KEYS } from './tools'
import type { Tool, ToolOptions } from './tools'
import { CommentLayer } from './ui/CommentLayer'
import type { CommentDraft } from './ui/CommentLayer'
import { CommentsPanel } from './ui/CommentsPanel'
import { ContextBar } from './ui/ContextBar'
import { ShareDialog } from './ui/ShareDialog'
import { TemplatesDialog } from './ui/TemplatesDialog'
import type { TemplateChoice } from './ui/TemplatesDialog'
import { TimerMenu, TimerPill } from './ui/Timer'
import { Toolbar } from './ui/Toolbar'
import { TopBar } from './ui/TopBar'
import { VOTABLE, VoteBadges, VoteBanner, VoteMenu } from './ui/Voting'
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

interface BoardScreenProps {
  boardId: string
  user: User
  onSignOut(): void
}

/** Asks the server what you may do on the board, then opens it for real-time editing (or viewing). */
export function BoardScreen({ boardId, user, onSignOut }: BoardScreenProps) {
  const identity = useMemo<Identity>(() => ({ id: user.id, name: user.name, color: user.color }), [user])
  const [access, setAccess] = useState<BoardAccess | null>(null)
  const [problem, setProblem] = useState<ApiError | null>(null)
  const [session, setSession] = useState<BoardSession | null>(null)

  const load = useCallback(async () => {
    try {
      setAccess(await api.board(boardId))
      setProblem(null)
    } catch (err) {
      setProblem(err instanceof ApiError ? err : new ApiError(0, 'Something went wrong'))
    }
  }, [boardId])
  useEffect(() => {
    void load()
  }, [load])

  const ready = access !== null && problem === null
  useEffect(() => {
    if (!ready) return
    const opened = openBoardSession(boardId, identity)
    // The server hangs up when our access changes (or the board is deleted): ask again.
    const onClose = (event: CloseEvent | null) => {
      if (event?.code === ACCESS_CHANGED) void load()
    }
    opened.provider.on('connection-close', onClose)
    setSession(opened)
    return () => {
      opened.provider.off('connection-close', onClose)
      opened.destroy()
      setSession(null)
    }
  }, [boardId, ready, identity, load])

  if (problem) {
    const home = { label: 'Go to my boards', onClick: () => navigate('/') }
    if (problem.status === 404) {
      return (
        <MessageScreen title="Board not found" actions={[home]}>
          This board does not exist, or it was deleted.
        </MessageScreen>
      )
    }
    if (problem.status === 403) {
      return (
        <MessageScreen title="You don’t have access to this board" actions={[home, { label: 'Use another account', onClick: onSignOut }]}>
          You are signed in as {user.email}. Ask the board’s owner to invite you, or to open it to anyone with the link.
        </MessageScreen>
      )
    }
    if (problem.status === 401) {
      return (
        <MessageScreen title="Signed out" actions={[{ label: 'Sign in again', onClick: onSignOut }]}>
          Your session has ended.
        </MessageScreen>
      )
    }
    return (
      <MessageScreen title="Could not open the board" actions={[{ label: 'Try again', onClick: () => void load() }, home]}>
        {problem.message}
      </MessageScreen>
    )
  }
  if (!session || !access) return <div className="loading">Opening board…</div>
  return <BoardView session={session} identity={identity} user={user} access={access} onAccessChange={setAccess} onSignOut={onSignOut} />
}

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** Longest side of a newly added image, in board units. */
const MAX_IMAGE_SIDE = 480

async function naturalSize(file: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return { width: 320, height: 240 }
  }
}

const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

const round1 = (n: number) => Math.round(n * 10) / 10

function gridStyle(camera: Camera): CSSProperties {
  let step = 24 * camera.scale
  while (step < 12) step *= 4
  return { backgroundSize: `${step}px ${step}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }
}

interface BoardViewProps {
  session: BoardSession
  identity: Identity
  user: User
  access: BoardAccess
  onAccessChange(access: BoardAccess): void
  onSignOut(): void
}

function BoardView({ session, identity, user, access, onAccessChange, onSignOut }: BoardViewProps) {
  const { board } = session
  const readOnly = access.role === 'viewer'
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
  const [sharing, setSharing] = useState(false)
  const [choosingTemplate, setChoosingTemplate] = useState(false)
  const [commentsPanel, setCommentsPanel] = useState(false)
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null)
  const comments = useComments(session.comments)
  const facilitation = useFacilitation(session.facilitation)

  useEffect(() => {
    void syncClock()
  }, [])

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

  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const setTool = useCallback((next: Tool) => {
    if (readOnlyRef.current && !READ_ONLY_TOOLS.has(next)) return
    setToolState(next)
    if (next !== 'select') setEditingId(null)
  }, [])

  // Losing edit rights mid-session: drop whatever was being created or edited.
  useEffect(() => {
    if (!readOnly) return
    setToolState((current) => (READ_ONLY_TOOLS.has(current) ? current : 'select'))
    setEditingId(null)
  }, [readOnly])

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

  // Pasted and dropped things land under the pointer when it is over the
  // board, otherwise in the middle of the view.
  const pointerRef = useRef<Point | null>(null)
  useEffect(() => {
    const onMove = (evt: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const inside = evt.clientX >= rect.left && evt.clientX <= rect.right && evt.clientY >= rect.top && evt.clientY <= rect.bottom
      pointerRef.current = inside ? { x: evt.clientX - rect.left, y: evt.clientY - rect.top } : null
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  const pointerWorld = useCallback((): Point | null => (pointerRef.current ? toWorld(cameraRef.current, pointerRef.current) : null), [])
  const viewCenter = useCallback((): Point => toWorld(cameraRef.current, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }), [])

  const place = useCallback(
    (objects: NewObject[]) => {
      if (objects.length === 0) return
      board.checkpoint()
      const ids = board.createMany(objects)
      board.checkpoint()
      setTool('select')
      setSelection(ids)
    },
    [board, setTool],
  )

  const addImages = useCallback(
    async (files: File[], at: Point) => {
      const pictures = files.filter((file) => IMAGE_TYPES.test(file.type))
      if (pictures.length < files.length) flash('Only PNG, JPEG, GIF and WebP images can be added')
      const fitting = pictures.filter((file) => file.size <= MAX_IMAGE_BYTES)
      if (fitting.length < pictures.length) flash('Images must be under 10 MB')
      if (fitting.length === 0) return
      flash(fitting.length > 1 ? `Adding ${fitting.length} images…` : 'Adding the image…')
      const added = await Promise.all(
        fitting.map(async (file, i): Promise<NewObject | null> => {
          try {
            const [{ url }, natural] = await Promise.all([api.uploadImage(session.boardId, file), naturalSize(file)])
            const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(natural.width, natural.height, 1))
            const w = Math.max(24, Math.round(natural.width * scale))
            const h = Math.max(24, Math.round(natural.height * scale))
            const nudge = i * 24
            return { type: 'image', x: round1(at.x - w / 2 + nudge), y: round1(at.y - h / 2 + nudge), w, h, src: url, name: file.name.slice(0, 120), author: identity.name }
          } catch (err) {
            flash((err as Error).message)
            return null
          }
        }),
      )
      place(added.filter((obj): obj is NewObject => obj !== null))
    },
    [session.boardId, identity.name, flash, place],
  )

  const pastePayload = useCallback(
    async (payload: ClipboardPayload, at: Point | null) => {
      const fromHere = payload.board === session.boardId
      let objects: BoardObject[] = payload.objects
      if (!fromHere) {
        // Images belong to the board they were added to: copy them over.
        const imported = await Promise.all(
          objects.map(async (obj) => {
            if (obj.type !== 'image') return obj
            try {
              return { ...obj, src: (await api.importImage(session.boardId, obj.src)).url }
            } catch {
              return null
            }
          }),
        )
        objects = imported.filter((obj): obj is BoardObject => obj !== null)
        if (objects.length < payload.objects.length) flash('Some images could not be copied')
      }
      objects = pasteable(objects, (id) => board.get(id) !== undefined)
      const bounds = boundsOf(objects)
      if (!bounds) return
      const target = at ?? (fromHere ? null : viewCenter())
      const offset = target ? { x: round1(target.x - (bounds.x + bounds.w / 2)), y: round1(target.y - (bounds.y + bounds.h / 2)) } : { x: 24, y: 24 }
      board.checkpoint()
      const ids = board.insertCopies(objects, offset)
      board.checkpoint()
      setTool('select')
      setSelection(ids)
    },
    [board, session.boardId, flash, viewCenter, setTool],
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickImage = useCallback(() => fileInputRef.current?.click(), [])

  // Copy, cut and paste through the system clipboard: within a board,
  // between boards and tabs, and from other apps (images, text).
  const clip = useRef({ selection, snapshot, readOnly, remove, pastePayload, addImages, place, options })
  clip.current = { selection, snapshot, readOnly, remove, pastePayload, addImages, place, options }
  const lastCopied = useRef<ClipboardPayload | null>(null)
  useEffect(() => {
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (typingIn(e.target) || !e.clipboardData) return
      const state = clip.current
      const payload = copySelection(state.snapshot, state.selection, session.boardId)
      if (!payload) return
      e.preventDefault()
      e.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify(payload))
      e.clipboardData.setData('text/plain', plainText(payload))
      lastCopied.current = payload
      if (cut && !state.readOnly) state.remove()
    }
    const onCopy = (e: ClipboardEvent) => copy(e, false)
    const onCut = (e: ClipboardEvent) => copy(e, true)
    const onPaste = (e: ClipboardEvent) => {
      const state = clip.current
      if (typingIn(e.target) || !e.clipboardData || state.readOnly) return
      const data = e.clipboardData
      const at = pointerWorld()
      const payload = parsePayload(data.getData(CLIPBOARD_TYPE))
      if (payload) {
        e.preventDefault()
        void state.pastePayload(payload, at)
        return
      }
      const files = [...data.files]
      if (files.some((file) => file.type.startsWith('image/'))) {
        e.preventDefault()
        void state.addImages(files, at ?? viewCenter())
        return
      }
      const text = data.getData('text/plain')
      // Browsers that drop the private format still paste what this tab copied.
      if (lastCopied.current && text === plainText(lastCopied.current)) {
        e.preventDefault()
        void state.pastePayload(lastCopied.current, at)
        return
      }
      if (text.trim()) {
        e.preventDefault()
        state.place(textToObjects(text, at ?? viewCenter(), identity.name, state.options.stickyColor))
      }
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [session.boardId, identity.name, pointerWorld, viewCenter])

  const newBoard = async () => {
    try {
      const created = await api.createBoard()
      navigate(`/b/${created.board.id}`)
    } catch (err) {
      flash((err as Error).message)
    }
  }

  const exportBoard = (format: ExportFormat, onlySelection: boolean) => {
    const stage = stageRef.current
    if (!stage) return
    const current = board.getSnapshot()
    const only = onlySelection ? new Set(copySelection(current, selection, session.boardId)?.objects.map((obj) => obj.id) ?? []) : null
    // Mount every object in full detail for the duration of the render.
    flushSync(() => setFullRender(true))
    let canvas: HTMLCanvasElement | null
    try {
      canvas = renderBoard(stage, overlayRef.current, current, cameraRef.current, only)
    } finally {
      setFullRender(false)
    }
    if (!canvas) {
      flash('Nothing to export yet')
      return
    }
    downloadDataUrl(encodeBoard(canvas, format), fileNameFor(snapshot.title, format))
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
  const keyState = useRef({ selection, snapshot, duplicate, remove, fit, zoomAround, readOnly, pickImage })
  keyState.current = { selection, snapshot, duplicate, remove, fit, zoomAround, readOnly, pickImage }
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
        if (key === 'a') setSelection(state.snapshot.ordered.map((obj) => obj.id))
        else if (state.readOnly && (key === 'z' || key === 'y' || key === 'd')) e.preventDefault()
        else if (key === 'z') e.shiftKey ? board.redo() : board.undo()
        else if (key === 'y') board.redo()
        else if (key === 'd') state.duplicate()
        else if (e.key === '=' || e.key === '+') state.zoomAround((s) => s * 1.25)
        else if (e.key === '-') state.zoomAround((s) => s / 1.25)
        else if (e.key === '0') state.zoomAround(() => 1)
        else return
        e.preventDefault()
        return
      }
      if (e.altKey) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection.length > 0 && !state.readOnly) {
          e.preventDefault()
          state.remove()
        }
        return
      }
      if (e.key === 'Escape') {
        setSelection([])
        setTool('select')
        setCommentDraft(null)
        setOpenThread(null)
        return
      }
      if (e.key === 'Enter' && state.selection.length === 1 && !state.readOnly) {
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
      if (key === 'i') {
        if (!state.readOnly) state.pickImage()
        return
      }
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

  // --- Templates ------------------------------------------------------------

  const insertTemplate = useCallback(
    async (choice: TemplateChoice, fitAfter = false) => {
      setChoosingTemplate(false)
      try {
        let payload: ClipboardPayload
        if (choice.kind === 'built-in') {
          const template = builtInTemplate(choice.key)
          if (!template) return
          payload = { myoboard: 1, board: session.boardId, objects: template.build() }
        } else {
          const { template } = await api.template(choice.id)
          // Its images live with the template: pasting copies them to this board.
          payload = { myoboard: 1, board: `_t_${template.id}`, objects: template.objects as BoardObject[] }
        }
        await pastePayload(payload, viewCenter())
        if (fitAfter) {
          // A board made from a template opens on its content, nothing selected.
          setSelection([])
          window.requestAnimationFrame(() => fit())
        }
      } catch (err) {
        flash((err as Error).message)
      }
    },
    [session.boardId, pastePayload, viewCenter, fit, flash],
  )

  const saveTemplate = useCallback(
    async (name: string, description: string) => {
      const current = board.getSnapshot()
      const ids = selection.length > 0 ? selection : current.ordered.map((obj) => obj.id)
      const payload = copySelection(current, ids, session.boardId)
      if (!payload) throw new Error('The board is empty: add something first')
      await api.saveTemplate({ name, description, objects: payload.objects })
      flash(`Saved “${name}” for your team`)
    },
    [board, selection, session.boardId, flash],
  )

  // A board created from a template on the home page fills itself once synced.
  const pendingTemplate = useRef<TemplateChoice | null>(
    (() => {
      const value = new URLSearchParams(location.search).get('template')
      if (!value) return null
      return value.startsWith('team:') ? { kind: 'team', id: value.slice(5) } : { kind: 'built-in', key: value }
    })(),
  )
  useEffect(() => {
    if (!pendingTemplate.current || readOnly) return
    const run = () => {
      const choice = pendingTemplate.current
      if (!choice) return
      pendingTemplate.current = null
      history.replaceState(null, '', location.pathname)
      if (board.getSnapshot().ordered.length === 0) void insertTemplate(choice, true)
    }
    if (session.provider.synced) {
      run()
      return
    }
    const onSync = (synced: boolean) => {
      if (synced) run()
    }
    session.provider.on('sync', onSync)
    return () => session.provider.off('sync', onSync)
  }, [session, board, readOnly, insertTemplate])

  // --- Comments -------------------------------------------------------------

  const lookup = useCallback((id: string) => snapshot.byId.get(id), [snapshot])
  const me = useMemo(() => ({ id: identity.id, name: identity.name, color: identity.color }), [identity])
  const openCommentCount = comments.threads.filter((t) => !t.resolved).length

  const startComment = useCallback((at: CommentDraft) => {
    setOpenThread(null)
    setCommentDraft(at)
  }, [])

  const createComment = (text: string) => {
    if (!commentDraft) return
    const on = commentDraft.on ? board.get(commentDraft.on) : null
    session.comments.start({ x: commentDraft.x, y: commentDraft.y, on }, me, text)
    setCommentDraft(null)
    setTool('select')
  }

  /** Brings a thread's pin to the middle of the view and opens it. */
  const focusThread = (id: string) => {
    const thread = comments.threads.find((t) => t.id === id)
    if (!thread) return
    const at = pinPosition(thread, lookup)
    const { width, height } = sizeRef.current
    setCamera((cam) => ({ scale: cam.scale, x: width / 2 - at.x * cam.scale, y: height / 2 - at.y * cam.scale }))
    setCommentDraft(null)
    setOpenThread(id)
  }

  // --- Voting ----------------------------------------------------------------

  const voting = facilitation.vote?.status === 'running' && !readOnly
  const vote = useCallback(
    (id: string, retract: boolean) => {
      const target = board.get(id)
      if (!target || !VOTABLE.has(target.type)) return
      if (retract) session.facilitation.retractVote(identity.id, id)
      else if (!session.facilitation.castVote(identity.id, id)) flash('No votes left: Shift-click a note to take one back')
    },
    [board, session.facilitation, identity.id, flash],
  )
  const showObject = (id: string) => {
    const obj = board.get(id)
    const box = obj ? objectBounds(obj, lookup) : null
    if (!box) return
    const { width, height } = sizeRef.current
    setCamera((cam) => ({ scale: cam.scale, x: width / 2 - (box.x + box.w / 2) * cam.scale, y: height / 2 - (box.y + box.h / 2) * cam.scale }))
    setSelection([id])
  }

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
  // The context bar floats just above the selection (or below it, near the top edge).
  const selectionBox = useMemo(() => {
    const lookup = (id: string) => snapshot.byId.get(id)
    return unionBoxes(selectedObjects.flatMap((obj) => objectBounds(obj, lookup) ?? []))
  }, [selectedObjects, snapshot])
  const contextBarAt = (() => {
    if (!selectionBox) return null
    const topLeft = toScreen(camera, { x: selectionBox.x, y: selectionBox.y })
    const bottom = topLeft.y + selectionBox.h * camera.scale
    const centerX = topLeft.x + (selectionBox.w * camera.scale) / 2
    const above = topLeft.y - 62
    const y = above > 70 ? above : Math.min(bottom + 14, size.height - 60)
    const margin = Math.min(260, size.width / 2)
    return { x: Math.min(Math.max(centerX, margin), size.width - margin), y }
  })()
  const editing = editingId ? snapshot.byId.get(editingId) : undefined
  const editingObj = editing && EDITABLE.has(editing.type) ? (editing as EditableObject) : null
  const labelAnchor =
    editingObj?.type === 'connector' ? (connectorRoute(editingObj, (id) => snapshot.byId.get(id))?.mid ?? null) : null

  return (
    <div
      className="board"
      data-tool={tool}
      data-pan-ready={panKey || tool === 'hand' ? 'true' : undefined}
      data-panning={panning ? 'true' : undefined}
    >
      <div
        className="canvas-wrap"
        ref={wrapRef}
        style={gridStyle(camera)}
        onPointerDownCapture={() => {
          autoFitRef.current = false
          if (tool !== 'comment') {
            setOpenThread(null)
            setCommentDraft(null)
          }
        }}
        onDragOver={(e) => {
          if (readOnly || ![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files]
          if (readOnly || files.length === 0) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          void addImages(files, toWorld(cameraRef.current, { x: e.clientX - rect.left, y: e.clientY - rect.top }))
        }}
      >
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
            readOnly={readOnly}
            onCommentAt={startComment}
            onVote={voting ? vote : undefined}
          />
        )}
        <PeerCursors awareness={session.awareness} camera={camera} />
        {editingObj && (
          <TextEditor
            key={editingObj.id}
            obj={editingObj}
            anchor={labelAnchor}
            camera={camera}
            onChange={(value) =>
              board.update(
                editingObj.id,
                editingObj.type === 'section' ? { title: value } : editingObj.type === 'connector' ? { label: value } : { text: value },
              )
            }
            onClose={closeEditor}
          />
        )}
        {snapshot.ordered.length === 0 && (
          <p className="empty-hint">
            {readOnly ? (
              'This board is empty.'
            ) : (
              <>
                Pick a tool on the left, or press <kbd>S</kbd> and click to add a sticky note.
              </>
            )}
          </p>
        )}
      </div>

      <VoteBadges state={facilitation} me={me} lookup={lookup} camera={camera} />
      <CommentLayer
        comments={session.comments}
        threads={comments.threads}
        lookup={lookup}
        camera={camera}
        size={size}
        me={me}
        isOwner={access.role === 'owner'}
        readOnly={readOnly}
        showResolved={false}
        openId={openThread}
        onOpen={(id) => {
          setCommentDraft(null)
          setOpenThread(id)
        }}
        draft={commentDraft}
        onCancelDraft={() => setCommentDraft(null)}
        onCreate={createComment}
      />

      <TopBar
        title={snapshot.title}
        onRename={(title) => board.setTitle(title)}
        readOnly={readOnly}
        user={user}
        onSignOut={onSignOut}
        peers={peers}
        status={status}
        canUndo={board.canUndo()}
        canRedo={board.canRedo()}
        onUndo={() => board.undo()}
        onRedo={() => board.redo()}
        selectionCount={selection.length}
        onExport={exportBoard}
        onNewBoard={newBoard}
        onShare={() => setSharing(true)}
        onHome={() => navigate('/')}
        openComments={openCommentCount}
        commentsShown={commentsPanel}
        onToggleComments={() => setCommentsPanel((shown) => !shown)}
        onTemplates={() => setChoosingTemplate(true)}
        timerMenu={(close) => <TimerMenu facilitation={session.facilitation} timer={facilitation.timer} me={me} readOnly={readOnly} onDone={close} />}
        timerActive={facilitation.timer !== null}
        voteMenu={(close) => <VoteMenu facilitation={session.facilitation} state={facilitation} me={me} readOnly={readOnly} onDone={close} />}
        voteActive={facilitation.vote !== null}
      />
      <div className="top-center">
        <TimerPill facilitation={session.facilitation} timer={facilitation.timer} readOnly={readOnly} />
        <VoteBanner facilitation={session.facilitation} state={facilitation} me={me} readOnly={readOnly} lookup={lookup} onShow={showObject} />
      </div>
      {commentsPanel && (
        <CommentsPanel threads={comments.threads} openId={openThread} onFocus={focusThread} onClose={() => setCommentsPanel(false)} />
      )}
      {choosingTemplate && (
        <TemplatesDialog
          user={user}
          canEdit={!readOnly}
          selectionCount={selection.length}
          onInsert={(choice) => void insertTemplate(choice)}
          onSave={saveTemplate}
          onClose={() => setChoosingTemplate(false)}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        aria-label="Add images"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length > 0) void addImages(files, viewCenter())
        }}
      />
      <Toolbar
        tool={tool}
        options={options}
        readOnly={readOnly}
        onAddImage={pickImage}
        onToolChange={setTool}
        onOptionsChange={(patch) => setOptions((o) => ({ ...o, ...patch }))}
      />
      {sharing && <ShareDialog access={access} title={snapshot.title} onChange={onAccessChange} onClose={() => setSharing(false)} />}
      {!editingId && !panning && contextBarAt && !readOnly && (
        <ContextBar
          board={board}
          selected={selectedObjects}
          position={contextBarAt}
          onDuplicate={duplicate}
          onDelete={remove}
          onEditText={(id) => setEditingId(id)}
        />
      )}
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
