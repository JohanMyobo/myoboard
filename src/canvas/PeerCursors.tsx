import type { Awareness } from 'y-protocols/awareness'
import { usePeers } from '../hooks'
import type { Camera } from './camera'

/** Other people's pointers, drawn in screen space so they keep their size at any zoom. */
export function PeerCursors({ awareness, camera }: { awareness: Awareness; camera: Camera }) {
  const peers = usePeers(awareness, true)
  return (
    <div className="peer-cursors" aria-hidden>
      {peers.map((peer) => {
        if (!peer.cursor) return null
        const x = peer.cursor.x * camera.scale + camera.x
        const y = peer.cursor.y * camera.scale + camera.y
        return (
          <div key={peer.clientId} className="peer-cursor" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <svg width="20" height="20" viewBox="0 0 20 20">
              <path
                d="M3 2.5 16.5 9l-6 1.6-2.7 5.9z"
                fill={peer.user.color}
                stroke="#ffffff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ background: peer.user.color }}>{peer.user.name}</span>
          </div>
        )
      })}
    </div>
  )
}
