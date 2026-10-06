import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { customAlphabet, nanoid } from 'nanoid'
import type { Auth } from './auth'
import { MAX_ASSET_BYTES, contentTypeOf, parseAssetUrl } from './assets'
import type { AssetStore } from './assets'
import { HttpError, readBody, readJson, sameOrigin, sendJson } from './http'
import { isValidRoomName } from './rooms'
import type { RoomManager } from './rooms'
import { LINK_ACCESS, MEMBER_ROLES, normalizeEmail } from './store'
import type { BoardRecord, LinkAccess, MemberRole, Role, Store, User } from './store'

export interface ApiDeps {
  store: Store
  auth: Auth
  rooms: RoomManager
  assets: AssetStore
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }
/** Images saved with a team template live under this pseudo-board, readable by everyone signed in. */
const TEMPLATE_MEDIA = '_t_'
const templateMedia = (templateId: string) => `${TEMPLATE_MEDIA}${templateId}`
/** Letters and digits only: ids starting with `_` are reserved, and these read well in links. */
const newBoardId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10)
const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024
const MAX_TEMPLATE_OBJECTS = 2000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The JSON API under /api, and board images under /media. Every route needs
 * a signed-in user, and every board route checks that user's role.
 */
export function createApi({ store, auth, rooms, assets }: ApiDeps) {
  const requireUser = (req: IncomingMessage): User => {
    const user = auth.userFromRequest(req)
    if (!user) throw new HttpError(401, 'Sign in first')
    return user
  }

  /** The board and the user's role on it, if at least `minimum`. */
  const access = (id: string, user: User, minimum: Role): { board: BoardRecord; role: Role } => {
    const board = isValidRoomName(id) ? store.getBoard(id) : undefined
    if (!board) throw new HttpError(404, 'This board does not exist, or was deleted')
    const role = store.roleFor(id, user)
    if (!role) throw new HttpError(403, 'You do not have access to this board')
    if (RANK[role] < RANK[minimum]) throw new HttpError(403, minimum === 'owner' ? 'Only the owner can do that' : 'You can only view this board')
    return { board, role }
  }

  /** Reading an image needs access to its board, or just a session for a template's images. */
  const canReadMedia = (board: string, user: User) => {
    if (board.startsWith(TEMPLATE_MEDIA)) {
      if (!store.getTemplate(board.slice(TEMPLATE_MEDIA.length))) throw new HttpError(404, 'No such image')
      return
    }
    access(board, user, 'viewer')
  }

  /** Boards from before sign-in existed have no owner: the first person to open one gets it. */
  const claimLegacy = (id: string, user: User): void => {
    if (!isValidRoomName(id) || store.getBoard(id)) return
    const file = rooms.fileFor(id)
    if (file && fs.existsSync(file)) store.createBoard({ id, ownerId: user.id })
  }

  const describe = (board: BoardRecord, role: Role) => {
    const owner = store.getUser(board.ownerId)
    return {
      board: { ...board, owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null },
      role,
      members: store.members(board.id),
    }
  }

  /** After a permission change, people whose role changed reconnect with the new one. */
  const refresh = (id: string) =>
    rooms.refreshAccess(id, (userId) => {
      const user = store.getUser(userId)
      const role = user ? store.roleFor(id, user) : null
      return role ? role === 'viewer' : null
    })

  const serveAsset = (res: ServerResponse, board: string, file: string) => {
    const location = assets.pathFor(board, file)
    if (!location || !fs.existsSync(location)) throw new HttpError(404, 'No such image')
    res.writeHead(200, {
      'content-type': contentTypeOf(file),
      'content-length': fs.statSync(location).size,
      // Named by content, so it never changes; private because it needs a session.
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    })
    fs.createReadStream(location).pipe(res)
  }

  /** Handles /api/* and /media/*. Returns false for any other path. */
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const { pathname } = url
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/media/')) return false
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req, auth.publicUrl)) throw new HttpError(403, 'Cross-site request refused')

    if (pathname === '/api/me' && method === 'GET') {
      sendJson(res, 200, { user: auth.userFromRequest(req) ?? null, auth: auth.info })
      return true
    }
    if (pathname === '/api/time' && method === 'GET') {
      sendJson(res, 200, { now: Date.now() })
      return true
    }

    const user = requireUser(req)

    const asset = parseAssetUrl(pathname)
    if (asset && method === 'GET') {
      canReadMedia(asset.board, user)
      serveAsset(res, asset.board, asset.file)
      return true
    }

    if (pathname === '/api/boards') {
      if (method === 'GET') {
        sendJson(res, 200, { boards: store.boardsFor(user) })
        return true
      }
      if (method === 'POST') {
        const body = await readJson(req)
        const id = body.id === undefined ? newBoardId() : body.id
        if (typeof id !== 'string' || !isValidRoomName(id) || id.startsWith('_')) throw new HttpError(400, 'Invalid board id')
        const file = rooms.fileFor(id)
        if (store.getBoard(id) || (file && fs.existsSync(file))) throw new HttpError(409, 'A board with this id already exists')
        const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
        const board = store.createBoard({ id, ownerId: user.id, title })
        store.recordVisit(user.id, id)
        sendJson(res, 201, describe(board, 'owner'))
        return true
      }
    }

    const boardRoute = /^\/api\/boards\/([^/]+)(\/.*)?$/.exec(pathname)
    if (boardRoute) {
      const id = boardRoute[1]
      const rest = boardRoute[2] ?? ''

      if (rest === '' && method === 'GET') {
        claimLegacy(id, user)
        const { board, role } = access(id, user, 'viewer')
        store.recordVisit(user.id, id)
        sendJson(res, 200, describe(board, role))
        return true
      }
      if (rest === '' && method === 'PATCH') {
        access(id, user, 'owner')
        const body = await readJson(req)
        if (body.linkAccess !== undefined) {
          if (!LINK_ACCESS.includes(body.linkAccess as LinkAccess)) throw new HttpError(400, 'Invalid link access')
          store.setLinkAccess(id, body.linkAccess as LinkAccess)
          refresh(id)
        }
        sendJson(res, 200, describe(store.getBoard(id)!, 'owner'))
        return true
      }
      if (rest === '' && method === 'DELETE') {
        access(id, user, 'owner')
        rooms.discard(id)
        store.deleteBoard(id)
        const file = rooms.fileFor(id)
        if (file) fs.rmSync(file, { force: true })
        assets.removeBoard(id)
        res.writeHead(204).end()
        return true
      }
      if (rest === '/members' && method === 'PUT') {
        const { board } = access(id, user, 'owner')
        const body = await readJson(req)
        const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
        if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address')
        if (!MEMBER_ROLES.includes(body.role as MemberRole)) throw new HttpError(400, 'Invalid role')
        if (store.getUser(board.ownerId)?.email === email) throw new HttpError(400, 'That is the owner of the board')
        store.setMember(id, email, body.role as MemberRole)
        refresh(id)
        sendJson(res, 200, describe(store.getBoard(id)!, 'owner'))
        return true
      }
      const member = /^\/members\/([^/]+)$/.exec(rest)
      if (member && method === 'DELETE') {
        access(id, user, 'owner')
        store.removeMember(id, decodeURIComponent(member[1]))
        refresh(id)
        sendJson(res, 200, describe(store.getBoard(id)!, 'owner'))
        return true
      }
      if (rest === '/assets' && method === 'POST') {
        access(id, user, 'editor')
        const bytes = await readBody(req, MAX_ASSET_BYTES)
        const file = assets.save(id, bytes)
        if (!file) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images can be added')
        sendJson(res, 201, { url: `/media/${id}/${file}` })
        return true
      }
      if (rest === '/assets/import' && method === 'POST') {
        access(id, user, 'editor')
        const body = await readJson(req)
        const source = typeof body.url === 'string' ? parseAssetUrl(body.url) : null
        if (!source) throw new HttpError(400, 'Invalid image address')
        canReadMedia(source.board, user)
        const file = assets.copy(source.board, source.file, id)
        if (!file) throw new HttpError(404, 'No such image')
        sendJson(res, 201, { url: `/media/${id}/${file}` })
        return true
      }
    }

    if (pathname === '/api/templates') {
      if (method === 'GET') {
        const templates = store.templates().map(({ objects, ...rest }) => ({ ...rest, count: objects.length }))
        sendJson(res, 200, { templates })
        return true
      }
      if (method === 'POST') {
        const body = await readJson(req, MAX_TEMPLATE_BYTES)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) throw new HttpError(400, 'Give the template a name')
        const objects = body.objects
        if (!Array.isArray(objects) || objects.length === 0) throw new HttpError(400, 'A template needs at least one object')
        if (objects.length > MAX_TEMPLATE_OBJECTS) throw new HttpError(400, `A template can hold up to ${MAX_TEMPLATE_OBJECTS} objects`)
        if (!objects.every((obj) => obj && typeof obj === 'object' && typeof (obj as { type?: unknown }).type === 'string')) {
          throw new HttpError(400, 'Invalid template objects')
        }
        const description = typeof body.description === 'string' ? body.description : ''
        // Images move into the template, so people without access to the
        // board they came from can still use it.
        const id = nanoid(12)
        const kept = objects.flatMap((obj) => {
          const item = obj as { type: string; src?: unknown }
          if (item.type !== 'image') return [obj]
          const source = typeof item.src === 'string' ? parseAssetUrl(item.src) : null
          if (!source) return []
          try {
            canReadMedia(source.board, user)
          } catch {
            return []
          }
          const file = assets.copy(source.board, source.file, templateMedia(id))
          return file ? [{ ...item, src: `/media/${templateMedia(id)}/${file}` }] : []
        })
        if (kept.length === 0) throw new HttpError(400, 'Nothing in this template can be saved')
        const template = store.createTemplate({ id, name, description, ownerId: user.id, objects: kept })
        sendJson(res, 201, { template })
        return true
      }
    }
    const templateRoute = /^\/api\/templates\/([^/]+)$/.exec(pathname)
    if (templateRoute) {
      const template = store.getTemplate(templateRoute[1])
      if (!template) throw new HttpError(404, 'No such template')
      if (method === 'GET') {
        sendJson(res, 200, { template })
        return true
      }
      if (method === 'DELETE') {
        if (template.ownerId !== user.id) throw new HttpError(403, 'Only whoever saved a template can delete it')
        store.deleteTemplate(template.id)
        assets.removeBoard(templateMedia(template.id))
        res.writeHead(204).end()
        return true
      }
    }

    throw new HttpError(404, 'Not found')
  }
}
