import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type { WebsocketProvider } from 'y-websocket'
import type { Board, BoardSnapshot } from './model/board'
import type { Comments, CommentsSnapshot } from './model/comments'
import type { Facilitation, FacilitationSnapshot } from './model/facilitation'
import type { ConnectionStatus, PresenceState } from './sync/session'

export function useBoardSnapshot(board: Board): BoardSnapshot {
  return useSyncExternalStore(board.subscribe, board.getSnapshot)
}

export function useComments(comments: Comments): CommentsSnapshot {
  return useSyncExternalStore(comments.subscribe, comments.getSnapshot)
}

export function useFacilitation(facilitation: Facilitation): FacilitationSnapshot {
  return useSyncExternalStore(facilitation.subscribe, facilitation.getSnapshot)
}

/** Re-renders every `ms` while `active`, for countdowns. */
export function useTicker(active: boolean, ms = 250): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((t) => t + 1), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
  return tick
}

export interface Peer extends PresenceState {
  clientId: number
}

/**
 * The other people on the board. With `withCursors` false, cursor moves do
 * not cause re-renders, which matters for components that ignore cursors.
 */
export function usePeers(awareness: Awareness, withCursors = true): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([])
  useEffect(() => {
    let last = ''
    const read = () => {
      const list: Peer[] = []
      awareness.getStates().forEach((state, clientId) => {
        const presence = state as Partial<PresenceState> | null
        if (clientId === awareness.clientID || !presence?.user) return
        list.push({
          clientId,
          user: presence.user,
          cursor: withCursors ? (presence.cursor ?? null) : null,
          selection: Array.isArray(presence.selection) ? presence.selection : [],
        })
      })
      list.sort((a, b) => a.clientId - b.clientId)
      const key = JSON.stringify(list)
      if (key !== last) {
        last = key
        setPeers(list)
      }
    }
    read()
    awareness.on('change', read)
    return () => awareness.off('change', read)
  }, [awareness, withCursors])
  return peers
}

const currentStatus = (provider: WebsocketProvider): ConnectionStatus =>
  provider.wsconnected ? 'connected' : provider.wsconnecting ? 'connecting' : 'disconnected'

export function useConnectionStatus(provider: WebsocketProvider): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() => currentStatus(provider))
  useEffect(() => {
    // The socket may have connected between the first render and this effect.
    setStatus(currentStatus(provider))
    const onStatus = (event: { status: ConnectionStatus }) => setStatus(event.status)
    provider.on('status', onStatus)
    return () => provider.off('status', onStatus)
  }, [provider])
  return status
}

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
