import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { call, connect, signIn, startApp, synced, tryOpen, waitFor } from './test-helpers'
import type { Running } from './test-helpers'

describe('sync server', () => {
  let dataDir: string
  let running: Running
  let cookie: string

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myoboard-test-'))
    running = await startApp({ dataDir })
    cookie = await signIn(running.base, 'Ada')
    for (const id of ['board-1', 'board-2']) await call(running.base, cookie, 'POST', '/api/boards', { id })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await running.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('relays edits between two clients of the same board', async () => {
    const a = connect(running.wsUrl, 'board-1', cookie)
    const b = connect(running.wsUrl, 'board-1', cookie)
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.doc.getMap('objects').set('x', 1)
    await waitFor(() => b.doc.getMap('objects').get('x') === 1)
  })

  it('keeps boards apart', async () => {
    const a = connect(running.wsUrl, 'board-1', cookie)
    const b = connect(running.wsUrl, 'board-2', cookie)
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.doc.getMap('objects').set('x', 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(b.doc.getMap('objects').get('x')).toBeUndefined()
  })

  it('shares presence (cursors) between clients', async () => {
    const a = connect(running.wsUrl, 'board-1', cookie)
    const b = connect(running.wsUrl, 'board-1', cookie)
    await Promise.all([synced(a.provider), synced(b.provider)])
    a.provider.awareness.setLocalStateField('user', { name: 'Ada' })
    await waitFor(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Ada'))
  })

  it('saves a board when everyone leaves and loads it for the next visitor', async () => {
    const a = connect(running.wsUrl, 'board-1', cookie)
    await synced(a.provider)
    a.doc.getMap('objects').set('kept', 'yes')
    await waitFor(() => fs.existsSync(path.join(dataDir, 'board-1.ybin')))
    a.provider.destroy()
    await waitFor(() => running.app.rooms.openRooms === 0)

    const later = connect(running.wsUrl, 'board-1', cookie)
    await synced(later.provider)
    await waitFor(() => later.doc.getMap('objects').get('kept') === 'yes')
  })

  it('keeps serving when a save fails, and saves once it can', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = connect(running.wsUrl, 'board-1', cookie)
    await synced(a.provider)
    // A folder where the save writes its temporary file makes every save fail.
    const file = path.join(dataDir, 'board-1.ybin')
    const tmp = `${file}.${process.pid}.tmp`
    fs.mkdirSync(tmp)
    a.doc.getMap('objects').set('kept', 'yes')
    await waitFor(() => errors.mock.calls.length > 0)

    const b = connect(running.wsUrl, 'board-1', cookie)
    await waitFor(() => b.doc.getMap('objects').get('kept') === 'yes')

    fs.rmSync(tmp, { recursive: true })
    await waitFor(() => fs.existsSync(file))
    const saved = new Y.Doc()
    Y.applyUpdate(saved, fs.readFileSync(file))
    expect(saved.getMap('objects').get('kept')).toBe('yes')
  })

  it('refuses board ids that are not safe file names', async () => {
    expect(await tryOpen(`${running.wsUrl}/..%2F..%2Fetc`, cookie)).toBe('refused')
  })

  it('refuses people who are not signed in, and boards that do not exist', async () => {
    expect(await tryOpen(`${running.wsUrl}/board-1`, null)).toBe('refused')
    expect(await tryOpen(`${running.wsUrl}/no-such-board`, cookie)).toBe('refused')
    expect(await tryOpen(`${running.wsUrl}/board-1`, cookie)).toBe('open')
  })

  it('refuses connections opened from another site', async () => {
    expect(await tryOpen(`${running.wsUrl}/board-1`, cookie, { origin: 'https://evil.example' })).toBe('refused')
  })

  it('gives a board the title it was created with', async () => {
    await call(running.base, cookie, 'POST', '/api/boards', { id: 'titled', title: 'Kick-off' })
    const a = connect(running.wsUrl, 'titled', cookie)
    await synced(a.provider)
    await waitFor(() => a.doc.getMap('meta').get('title') === 'Kick-off')
  })

  it('records a board title for the board list', async () => {
    const a = connect(running.wsUrl, 'board-1', cookie)
    await synced(a.provider)
    a.doc.getMap('meta').set('title', 'Sprint retro')
    await waitFor(() => running.app.store.getBoard('board-1')?.title === 'Sprint retro')
  })
})
