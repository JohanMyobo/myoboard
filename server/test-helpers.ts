import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createAppServer } from './app'
import type { AppServerOptions } from './app'

/** Shared by the server tests: a running app, signed-in users, sync clients. */

export type App = ReturnType<typeof createAppServer>

export interface Running {
  app: App
  base: string
  wsUrl: string
  close(): Promise<void>
}

const providers: WebsocketProvider[] = []

export async function startApp(options: Partial<AppServerOptions> = {}): Promise<Running> {
  const app = createAppServer({ dataDir: null, distDir: null, saveDelayMs: 20, maxSaveDelayMs: 50, ...options })
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      for (const p of providers.splice(0)) p.destroy()
      await new Promise((resolve) => app.server.close(resolve))
    },
  }
}

/** Signs in (local mode) and returns the session cookie. */
export async function signIn(base: string, name: string, email = `${name.toLowerCase()}@example.com`): Promise<string> {
  const res = await fetch(`${base}/auth/local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email }),
  })
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`)
  return res.headers.get('set-cookie')!.split(';')[0]
}

export async function call(
  base: string,
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = { text }
  }
  return { status: res.status, json }
}

/** A WebSocket class that sends a session cookie, as a browser would. */
function socketWithCookie(cookie: string | null) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, cookie ? { headers: { cookie } } : {})
    }
  } as unknown as typeof globalThis.WebSocket
}

export function connect(wsUrl: string, room: string, cookie: string | null, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(wsUrl, room, doc, {
    WebSocketPolyfill: socketWithCookie(cookie),
    // Tabs in one process would otherwise sync through BroadcastChannel, skipping the server.
    disableBc: true,
  })
  providers.push(provider)
  return { doc, provider }
}

export function synced(provider: WebsocketProvider): Promise<void> {
  return new Promise((resolve) => {
    if (provider.synced) resolve()
    else provider.once('sync', () => resolve())
  })
}

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Opens a raw WebSocket and reports whether the server let it in. */
export function tryOpen(url: string, cookie: string | null, headers: Record<string, string> = {}): Promise<'open' | 'refused'> {
  const socket = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), ...headers } })
  return new Promise((resolve) => {
    socket.on('open', () => {
      socket.close()
      resolve('open')
    })
    socket.on('error', () => resolve('refused'))
  })
}
