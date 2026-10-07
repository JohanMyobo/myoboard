import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import sirv from 'sirv'
import { WebSocketServer } from 'ws'
import { createApi } from './api'
import { AssetStore } from './assets'
import { Auth } from './auth'
import type { AuthOptions } from './auth'
import { sameOrigin, sendError } from './http'
import { RoomManager, isValidRoomName } from './rooms'
import type { RoomManagerOptions } from './rooms'
import { Store } from './store'

export interface AppServerOptions extends RoomManagerOptions {
  /** Directory of the built web app to serve, or null to serve the API and sync only. */
  distDir: string | null
  auth?: AuthOptions
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/**
 * The HTTP server: sign-in under /auth, the JSON API under /api, board images
 * under /media, the y-websocket sync endpoint on /ws/<board>, and the web
 * app on every other path (single-page fallback).
 */
export function createAppServer(options: AppServerOptions) {
  const { dataDir } = options
  const store = new Store(dataDir ? path.join(dataDir, 'myoboard.db') : null)
  const assets = new AssetStore(dataDir ? path.join(dataDir, 'media') : fs.mkdtempSync(path.join(os.tmpdir(), 'myoboard-media-')))
  const rooms = new RoomManager({
    ...options,
    onTitle: (board, title) => store.setTitle(board, title),
    initialTitle: (board) => store.getBoard(board)?.title || undefined,
    onSaved: (board, editedAt) => store.touchBoard(board, editedAt),
  })
  const auth = new Auth(store, options.auth)
  const api = createApi({ store, auth, rooms, assets })
  const app = options.distDir ? sirv(options.distDir, { single: true, etag: true }) : null

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    try {
      if (await auth.handle(req, res, url)) return
      if (await api(req, res, url)) return
    } catch (err) {
      if (res.headersSent) res.destroy()
      else sendError(res, err)
      return
    }
    if (app) {
      app(req, res, () => {
        res.writeHead(404).end('Not found')
      })
      return
    }
    res
      .writeHead(200, { 'content-type': 'text/plain' })
      .end('Myoboard API and sync server. Run `npm run build` to serve the app.')
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const match = /^\/ws\/([^/]+)$/.exec(pathname)
    if (!match || !isValidRoomName(match[1])) return refuse(socket, '400 Bad Request')
    if (!sameOrigin(req, auth.publicUrl)) return refuse(socket, '403 Forbidden')
    const user = auth.userFromRequest(req)
    if (!user) return refuse(socket, '401 Unauthorized')
    const board = match[1]
    if (!store.getBoard(board)) return refuse(socket, '404 Not Found')
    const role = store.roleFor(board, user)
    if (!role) return refuse(socket, '403 Forbidden')
    wss.handleUpgrade(req, socket, head, (ws) => rooms.connect(ws, board, { userId: user.id, readOnly: role === 'viewer' }))
  })

  server.on('close', () => {
    for (const client of wss.clients) client.terminate()
    rooms.flushAll()
    store.close()
  })

  return { server, rooms, store, auth }
}
