import http from 'node:http'
import sirv from 'sirv'
import { WebSocketServer } from 'ws'
import { RoomManager, isValidRoomName } from './rooms'
import type { RoomManagerOptions } from './rooms'

export interface AppServerOptions extends RoomManagerOptions {
  /** Directory of the built web app to serve, or null to serve sync only. */
  distDir: string | null
}

/**
 * The HTTP server: the web app on every path (single-page fallback) and the
 * y-websocket sync endpoint on /ws/<board>.
 */
export function createAppServer(options: AppServerOptions) {
  const rooms = new RoomManager(options)
  const assets = options.distDir ? sirv(options.distDir, { single: true, etag: true }) : null

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    if (assets) {
      assets(req, res, () => {
        res.writeHead(404).end('Not found')
      })
      return
    }
    res
      .writeHead(200, { 'content-type': 'text/plain' })
      .end('Myoboard sync server. Run `npm run build` to serve the app.')
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const match = /^\/ws\/([^/]+)$/.exec(pathname)
    if (!match || !isValidRoomName(match[1])) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => rooms.connect(ws, match[1]))
  })

  server.on('close', () => {
    for (const client of wss.clients) client.terminate()
    rooms.flushAll()
  })

  return { server, rooms }
}
