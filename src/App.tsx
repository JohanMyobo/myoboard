import { useMemo } from 'react'
import { nanoid } from 'nanoid'
import { BoardScreen } from './BoardScreen'
import { isValidBoardId } from './sync/session'

/** Boards live at /b/<id>; any other address starts a new board. */
function resolveBoardId(): string {
  const match = /^\/b\/([^/]+)\/?$/.exec(location.pathname)
  if (match && isValidBoardId(match[1])) return match[1]
  const id = nanoid(10)
  history.replaceState(null, '', `/b/${id}`)
  return id
}

export function App() {
  const boardId = useMemo(resolveBoardId, [])
  return <BoardScreen key={boardId} boardId={boardId} />
}
