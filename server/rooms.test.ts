import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createAppServer } from './app'

type App = ReturnType<typeof createAppServer>

const providers: WebsocketProvider[] = []

function connect(url: string, room: string, doc = new Y.Doc()) {
  const provider = new WebsocketProvider(url, room, doc, {
    // Node has no global WebSocket in older versions, and tabs in one
    // process would otherwise sync through BroadcastChannel, skipping the server.
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  })
  providers.push(provider)
  return { doc, provider }
}

function synced(provider: WebsocketProvider): Promise<void> {
  return new Promise((resolve) => {
    if (provider.synced) resolve()
    else provider.once('sync', () => resolve())
  })
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('sync server', () => {
  let dataDir: string
  let app: App
  let url: string

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myoboard-test-'))
    app = createAppServer({ dataDir, distDir: null, saveDelayMs: 20, maxSaveDelayMs: 50 })
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`
  })

  afterEach(async () => {
    for (const p of providers.splice(0)) p.destroy()
    await new Promise((resolve) => app.server.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('relays edits between two clients of the same board', async () => {
    const a = connect(url, 'board-1')
    const b = connect(url, 'board-1')
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.doc.getMap('objects').set('x', 1)
    await waitFor(() => b.doc.getMap('objects').get('x') === 1)
  })

  it('keeps boards apart', async () => {
    const a = connect(url, 'board-1')
    const b = connect(url, 'board-2')
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.doc.getMap('objects').set('x', 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(b.doc.getMap('objects').get('x')).toBeUndefined()
  })

  it('shares presence (cursors) between clients', async () => {
    const a = connect(url, 'board-1')
    const b = connect(url, 'board-1')
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.provider.awareness.setLocalStateField('user', { name: 'Ada' })
    await waitFor(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Ada'))
  })

  it('saves a board when everyone leaves and loads it for the next visitor', async () => {
    const a = connect(url, 'board-1')
    await synced(a.provider)
    a.doc.getMap('objects').set('kept', 'yes')
    await waitFor(() => fs.existsSync(path.join(dataDir, 'board-1.ybin')))
    a.provider.destroy()
    await waitFor(() => app.rooms.openRooms === 0)

    const later = connect(url, 'board-1')
    await synced(later.provider)
    await waitFor(() => later.doc.getMap('objects').get('kept') === 'yes')
  })

  it('refuses board ids that are not safe file names', async () => {
    const socket = new WebSocket(`${url}/..%2F..%2Fetc`)
    const outcome = await new Promise<string>((resolve) => {
      socket.on('open', () => resolve('open'))
      socket.on('error', () => resolve('error'))
    })
    expect(outcome).toBe('error')
  })
})
