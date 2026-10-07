import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { call, connect, signIn, startApp, synced, tryOpen, waitFor } from './test-helpers'
import type { Running } from './test-helpers'

// The smallest valid PNG: 1x1, transparent.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('accounts and board permissions', () => {
  let dataDir: string
  let running: Running
  let base: string
  let owner: string
  let guest: string

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myoboard-access-'))
    running = await startApp({ dataDir })
    base = running.base
    owner = await signIn(base, 'Olivia')
    guest = await signIn(base, 'Gus')
  })

  afterEach(async () => {
    await running.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  const create = async (cookie = owner, body: Record<string, unknown> = {}) => {
    const res = await call(base, cookie, 'POST', '/api/boards', body)
    expect(res.status).toBe(201)
    return (res.json.board as { id: string }).id
  }

  it('needs a session for everything but /api/me', async () => {
    expect((await call(base, null, 'GET', '/api/boards')).status).toBe(401)
    const me = await call(base, null, 'GET', '/api/me')
    expect(me.json).toMatchObject({ user: null, auth: { local: true, providers: [] } })
    const signedIn = await call(base, owner, 'GET', '/api/me')
    expect(signedIn.json.user).toMatchObject({ name: 'Olivia', email: 'olivia@example.com' })
  })

  it('signs out', async () => {
    const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: owner } })
    expect(res.status).toBe(204)
    expect((await call(base, owner, 'GET', '/api/boards')).status).toBe(401)
  })

  it('rejects made-up emails in local sign-in', async () => {
    const res = await call(base, null, 'POST', '/auth/local', { name: 'X', email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('makes the creator the owner and lets anyone signed in with the link edit by default', async () => {
    const id = await create()
    expect((await call(base, owner, 'GET', `/api/boards/${id}`)).json.role).toBe('owner')
    expect((await call(base, guest, 'GET', `/api/boards/${id}`)).json.role).toBe('editor')
  })

  it('lists the boards someone owns, was invited to or opened', async () => {
    const mine = await create(owner, { title: 'Mine' })
    const theirs = await create(guest, { title: 'Theirs' })
    await call(base, guest, 'PATCH', `/api/boards/${theirs}`, { linkAccess: 'none' })
    let list = (await call(base, owner, 'GET', '/api/boards')).json.boards as { id: string; role: string }[]
    expect(list.map((b) => b.id)).toEqual([mine])

    await call(base, guest, 'PUT', `/api/boards/${theirs}/members`, { email: 'olivia@example.com', role: 'viewer' })
    list = (await call(base, owner, 'GET', '/api/boards')).json.boards as { id: string; role: string }[]
    expect(list.find((b) => b.id === theirs)?.role).toBe('viewer')
  })

  it('restricts a board to invited people when link access is off', async () => {
    const id = await create()
    await call(base, owner, 'PATCH', `/api/boards/${id}`, { linkAccess: 'none' })
    expect((await call(base, guest, 'GET', `/api/boards/${id}`)).status).toBe(403)
    expect(await tryOpen(`${running.wsUrl}/${id}`, guest)).toBe('refused')

    await call(base, owner, 'PUT', `/api/boards/${id}/members`, { email: 'GUS@example.com', role: 'viewer' })
    expect((await call(base, guest, 'GET', `/api/boards/${id}`)).json.role).toBe('viewer')
    const members = (await call(base, owner, 'GET', `/api/boards/${id}`)).json.members
    expect(members).toEqual([{ email: 'gus@example.com', role: 'viewer', name: 'Gus' }])

    await call(base, owner, 'DELETE', `/api/boards/${id}/members/gus%40example.com`)
    expect((await call(base, guest, 'GET', `/api/boards/${id}`)).status).toBe(403)
  })

  it('lets only the owner change access, invite or delete', async () => {
    const id = await create()
    expect((await call(base, guest, 'PATCH', `/api/boards/${id}`, { linkAccess: 'view' })).status).toBe(403)
    expect((await call(base, guest, 'PUT', `/api/boards/${id}/members`, { email: 'x@example.com', role: 'editor' })).status).toBe(403)
    expect((await call(base, guest, 'DELETE', `/api/boards/${id}`)).status).toBe(403)
  })

  it('never applies edits from a viewer, but still sends them the board', async () => {
    const id = await create()
    await call(base, owner, 'PATCH', `/api/boards/${id}`, { linkAccess: 'view' })
    const editor = connect(running.wsUrl, id, owner)
    const viewer = connect(running.wsUrl, id, guest)
    await Promise.all([synced(editor.provider), synced(viewer.provider)])

    viewer.doc.getMap('objects').set('sneaky', 1)
    editor.doc.getMap('objects').set('legit', 1)
    await waitFor(() => viewer.doc.getMap('objects').get('legit') === 1)
    await new Promise((r) => setTimeout(r, 100))
    expect(editor.doc.getMap('objects').get('sneaky')).toBeUndefined()

    // A newcomer gets the board as the server has it: without the viewer's edit.
    const later = connect(running.wsUrl, id, owner, new Y.Doc())
    await synced(later.provider)
    await waitFor(() => later.doc.getMap('objects').get('legit') === 1)
    expect(later.doc.getMap('objects').get('sneaky')).toBeUndefined()
  })

  it('disconnects people whose access changes, so they come back with their new role', async () => {
    const id = await create()
    const guestClient = connect(running.wsUrl, id, guest)
    await synced(guestClient.provider)
    const closes: number[] = []
    guestClient.provider.on('connection-close', (event: CloseEvent | null) => {
      if (event) closes.push(event.code)
    })
    await call(base, owner, 'PATCH', `/api/boards/${id}`, { linkAccess: 'view' })
    await waitFor(() => closes.includes(4000))
  })

  it('deletes a board with its file and images', async () => {
    const id = await create()
    const client = connect(running.wsUrl, id, owner)
    await synced(client.provider)
    client.doc.getMap('objects').set('x', 1)
    await waitFor(() => fs.existsSync(path.join(dataDir, `${id}.ybin`)))
    await fetch(`${base}/api/boards/${id}/assets`, { method: 'POST', headers: { cookie: owner }, body: PNG })

    expect((await call(base, owner, 'DELETE', `/api/boards/${id}`)).status).toBe(204)
    expect((await call(base, owner, 'GET', `/api/boards/${id}`)).status).toBe(404)
    await waitFor(() => !fs.existsSync(path.join(dataDir, `${id}.ybin`)))
    expect(fs.existsSync(path.join(dataDir, 'media', id))).toBe(false)
  })

  it('gives a board from before sign-in to the first person who opens it', async () => {
    const legacy = new Y.Doc()
    legacy.getMap('meta').set('title', 'Old board')
    fs.writeFileSync(path.join(dataDir, 'old-board.ybin'), Y.encodeStateAsUpdate(legacy))
    expect((await call(base, guest, 'GET', '/api/boards/old-board')).json.role).toBe('owner')
    expect((await call(base, owner, 'GET', '/api/boards/old-board')).json.role).toBe('editor')
  })

  it('refuses requests that change something from another site', async () => {
    const res = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('stores images per board and serves them only to people with access', async () => {
    const id = await create()
    const upload = await fetch(`${base}/api/boards/${id}/assets`, { method: 'POST', headers: { cookie: owner, 'content-type': 'image/png' }, body: PNG })
    expect(upload.status).toBe(201)
    const { url } = (await upload.json()) as { url: string }
    expect(url).toMatch(new RegExp(`^/media/${id}/[a-f0-9]{32}\\.png$`))

    const served = await fetch(`${base}${url}`, { headers: { cookie: owner } })
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true)

    await call(base, owner, 'PATCH', `/api/boards/${id}`, { linkAccess: 'none' })
    expect((await fetch(`${base}${url}`, { headers: { cookie: guest } })).status).toBe(403)
  })

  it('refuses files that are not images, SVG included', async () => {
    const id = await create()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await fetch(`${base}/api/boards/${id}/assets`, { method: 'POST', headers: { cookie: owner }, body: svg })
    expect(res.status).toBe(415)
  })

  it('copies an image into another board when it is pasted there', async () => {
    const from = await create()
    const to = await create(guest)
    const upload = await fetch(`${base}/api/boards/${from}/assets`, { method: 'POST', headers: { cookie: owner }, body: PNG })
    const { url } = (await upload.json()) as { url: string }
    const copied = await call(base, guest, 'POST', `/api/boards/${to}/assets/import`, { url })
    expect(copied.status).toBe(201)
    expect(copied.json.url).toMatch(new RegExp(`^/media/${to}/`))

    await call(base, owner, 'PATCH', `/api/boards/${from}`, { linkAccess: 'none' })
    expect((await call(base, guest, 'POST', `/api/boards/${to}/assets/import`, { url })).status).toBe(403)
  })

  it('keeps a template\'s images readable by everyone, even without access to their board', async () => {
    const id = await create()
    const upload = await fetch(`${base}/api/boards/${id}/assets`, { method: 'POST', headers: { cookie: owner }, body: PNG })
    const { url } = (await upload.json()) as { url: string }
    const saved = await call(base, owner, 'POST', '/api/templates', {
      name: 'With a picture',
      objects: [{ id: 'i', type: 'image', x: 0, y: 0, w: 10, h: 10, src: url }],
    })
    const template = saved.json.template as { id: string; objects: { src: string }[] }
    expect(template.objects[0].src).toMatch(new RegExp(`^/media/_t_${template.id}/`))
    await call(base, owner, 'PATCH', `/api/boards/${id}`, { linkAccess: 'none' })

    expect((await fetch(`${base}${template.objects[0].src}`, { headers: { cookie: guest } })).status).toBe(200)
    const theirs = await create(guest)
    const copied = await call(base, guest, 'POST', `/api/boards/${theirs}/assets/import`, { url: template.objects[0].src })
    expect(copied.status).toBe(201)
  })

  it('reserves board ids starting with an underscore, and never generates one', async () => {
    expect((await call(base, owner, 'POST', '/api/boards', { id: '_t_sneaky' })).status).toBe(400)
    // Random ids once started with `_` about one time in 64, and were refused.
    for (let i = 0; i < 300; i++) expect((await call(base, owner, 'POST', '/api/boards', {})).status).toBe(201)
  })

  it('shares team templates with everyone, and lets their author delete them', async () => {
    const saved = await call(base, owner, 'POST', '/api/templates', {
      name: 'Team retro',
      description: 'Our format',
      objects: [{ type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#ffe58f', text: 'Hi' }],
    })
    expect(saved.status).toBe(201)
    const id = (saved.json.template as { id: string }).id
    const list = (await call(base, guest, 'GET', '/api/templates')).json.templates as { name: string; count: number }[]
    expect(list).toMatchObject([{ name: 'Team retro', count: 1 }])
    expect(((await call(base, guest, 'GET', `/api/templates/${id}`)).json.template as { objects: unknown[] }).objects).toHaveLength(1)
    expect((await call(base, guest, 'DELETE', `/api/templates/${id}`)).status).toBe(403)
    expect((await call(base, owner, 'DELETE', `/api/templates/${id}`)).status).toBe(204)
  })
})
