import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import { PEOPLE_COLORS } from '../src/model/palette'

/**
 * Accounts, sessions, who can open which board, and team templates, in one
 * SQLite file next to the boards. Board content stays in the Yjs files.
 */

export type Role = 'owner' | 'editor' | 'viewer'
/** What someone who is signed in and has the link gets, without an invitation. */
export type LinkAccess = 'none' | 'view' | 'edit'
export type MemberRole = 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  color: string
}

export interface BoardRecord {
  id: string
  title: string
  ownerId: string
  linkAccess: LinkAccess
  createdAt: number
  updatedAt: number
}

export interface Member {
  email: string
  role: MemberRole
  /** Display name, once the person has signed in. */
  name: string | null
}

export interface BoardListing extends BoardRecord {
  role: Role
  ownerName: string
  lastOpenedAt: number | null
}

export interface TemplateRecord {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  createdAt: number
  objects: unknown[]
}

export const LINK_ACCESS: readonly LinkAccess[] = ['none', 'view', 'edit']
export const MEMBER_ROLES: readonly MemberRole[] = ['editor', 'viewer']

const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  link_access TEXT NOT NULL DEFAULT 'edit',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, email)
);
CREATE TABLE IF NOT EXISTS visits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  last_opened_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, board_id)
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  objects TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS members_by_email ON members(email);
`

type Row = Record<string, unknown>

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export function colorFor(email: string): string {
  const digest = crypto.createHash('sha256').update(normalizeEmail(email)).digest()
  return PEOPLE_COLORS[digest[0] % PEOPLE_COLORS.length]
}

function higher(a: Role | null, b: Role | null): Role | null {
  if (!a) return b
  if (!b) return a
  return RANK[a] >= RANK[b] ? a : b
}

const toUser = (row: Row): User => ({
  id: String(row.id),
  email: String(row.email),
  name: String(row.name),
  color: String(row.color),
})

const toBoard = (row: Row): BoardRecord => ({
  id: String(row.id),
  title: String(row.title),
  ownerId: String(row.owner_id),
  linkAccess: row.link_access as LinkAccess,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
})

export class Store {
  private readonly db: DatabaseSync

  /** `file` null keeps everything in memory (tests). */
  constructor(file: string | null) {
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file ?? ':memory:')
    this.db.exec('PRAGMA foreign_keys = ON')
    if (file) this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  // --- Users and sessions --------------------------------------------------

  /** Finds the account for an email address, creating it on first sign-in. */
  upsertUser(input: { email: string; name: string }): User {
    const email = normalizeEmail(input.email)
    const name = input.name.trim().slice(0, 60) || email.split('@')[0]
    const row = this.db
      .prepare(
        `INSERT INTO users (id, email, name, color, created_at) VALUES (:id, :email, :name, :color, :now)
         ON CONFLICT(email) DO UPDATE SET name = excluded.name
         RETURNING *`,
      )
      .get({ id: nanoid(12), email, name, color: colorFor(email), now: Date.now() })
    return toUser(row as Row)
  }

  getUser(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    return row ? toUser(row as Row) : undefined
  }

  createSession(userId: string): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + SESSION_MS
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt)
    return { token, expiresAt }
  }

  userForSession(token: string): User | undefined {
    const row = this.db
      .prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?')
      .get(hashToken(token), Date.now())
    return row ? toUser(row as Row) : undefined
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  }

  // --- Boards --------------------------------------------------------------

  createBoard(input: { id: string; ownerId: string; title?: string; linkAccess?: LinkAccess }): BoardRecord {
    const now = Date.now()
    const row = this.db
      .prepare(
        `INSERT INTO boards (id, title, owner_id, link_access, created_at, updated_at)
         VALUES (:id, :title, :owner, :access, :now, :now) RETURNING *`,
      )
      .get({ id: input.id, title: input.title ?? '', owner: input.ownerId, access: input.linkAccess ?? 'edit', now })
    return toBoard(row as Row)
  }

  getBoard(id: string): BoardRecord | undefined {
    const row = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(id)
    return row ? toBoard(row as Row) : undefined
  }

  deleteBoard(id: string): void {
    this.db.prepare('DELETE FROM boards WHERE id = ?').run(id)
  }

  setLinkAccess(id: string, access: LinkAccess): void {
    this.db.prepare('UPDATE boards SET link_access = ? WHERE id = ?').run(access, id)
  }

  setTitle(id: string, title: string): void {
    this.db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(title.slice(0, 200), id)
  }

  touchBoard(id: string, at = Date.now()): void {
    this.db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(at, id)
  }

  /** The most someone can do on a board: owner, invited role or link access, whichever is higher. */
  roleFor(boardId: string, user: User): Role | null {
    const board = this.getBoard(boardId)
    if (!board) return null
    if (board.ownerId === user.id) return 'owner'
    const member = this.db.prepare('SELECT role FROM members WHERE board_id = ? AND email = ?').get(boardId, user.email) as Row | undefined
    const invited = member ? (member.role as MemberRole) : null
    const viaLink: Role | null = board.linkAccess === 'edit' ? 'editor' : board.linkAccess === 'view' ? 'viewer' : null
    return higher(invited, viaLink)
  }

  members(boardId: string): Member[] {
    const rows = this.db
      .prepare(
        `SELECT members.email, members.role, users.name FROM members
         LEFT JOIN users ON users.email = members.email
         WHERE board_id = ? ORDER BY members.added_at`,
      )
      .all(boardId) as Row[]
    return rows.map((row) => ({ email: String(row.email), role: row.role as MemberRole, name: row.name == null ? null : String(row.name) }))
  }

  setMember(boardId: string, email: string, role: MemberRole): void {
    this.db
      .prepare(
        `INSERT INTO members (board_id, email, role, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role`,
      )
      .run(boardId, normalizeEmail(email), role, Date.now())
  }

  removeMember(boardId: string, email: string): void {
    this.db.prepare('DELETE FROM members WHERE board_id = ? AND email = ?').run(boardId, normalizeEmail(email))
  }

  recordVisit(userId: string, boardId: string): void {
    this.db
      .prepare(
        `INSERT INTO visits (user_id, board_id, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, board_id) DO UPDATE SET last_opened_at = excluded.last_opened_at`,
      )
      .run(userId, boardId, Date.now())
  }

  /** Boards someone owns, was invited to or has opened, and can still open; most recent first. */
  boardsFor(user: User): BoardListing[] {
    const rows = this.db
      .prepare(
        `SELECT boards.*, owners.name AS owner_name, visits.last_opened_at, members.role AS member_role
         FROM boards
         JOIN users AS owners ON owners.id = boards.owner_id
         LEFT JOIN visits ON visits.board_id = boards.id AND visits.user_id = :user
         LEFT JOIN members ON members.board_id = boards.id AND members.email = :email
         WHERE boards.owner_id = :user OR members.email IS NOT NULL OR visits.user_id IS NOT NULL`,
      )
      .all({ user: user.id, email: user.email }) as Row[]
    const listings: BoardListing[] = []
    for (const row of rows) {
      const board = toBoard(row)
      const role = this.roleFor(board.id, user)
      if (!role) continue
      const lastOpenedAt = row.last_opened_at == null ? null : Number(row.last_opened_at)
      listings.push({ ...board, role, ownerName: String(row.owner_name), lastOpenedAt })
    }
    const recency = (b: BoardListing) => Math.max(b.lastOpenedAt ?? 0, b.updatedAt)
    return listings.sort((a, b) => recency(b) - recency(a))
  }

  // --- Team templates ------------------------------------------------------

  createTemplate(input: { name: string; description: string; ownerId: string; objects: unknown[] }): TemplateRecord {
    const row = this.db
      .prepare(
        `INSERT INTO templates (id, name, description, owner_id, created_at, objects)
         VALUES (:id, :name, :description, :owner, :now, :objects) RETURNING id`,
      )
      .get({
        id: nanoid(12),
        name: input.name.trim().slice(0, 80),
        description: input.description.trim().slice(0, 300),
        owner: input.ownerId,
        now: Date.now(),
        objects: JSON.stringify(input.objects),
      }) as Row
    return this.getTemplate(String(row.id))!
  }

  getTemplate(id: string): TemplateRecord | undefined {
    const row = this.db
      .prepare('SELECT templates.*, users.name AS owner_name FROM templates JOIN users ON users.id = templates.owner_id WHERE templates.id = ?')
      .get(id) as Row | undefined
    return row ? this.toTemplate(row) : undefined
  }

  templates(): TemplateRecord[] {
    const rows = this.db
      .prepare('SELECT templates.*, users.name AS owner_name FROM templates JOIN users ON users.id = templates.owner_id ORDER BY templates.created_at DESC')
      .all() as Row[]
    return rows.map((row) => this.toTemplate(row))
  }

  deleteTemplate(id: string): void {
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  }

  private toTemplate(row: Row): TemplateRecord {
    let objects: unknown[] = []
    try {
      const parsed: unknown = JSON.parse(String(row.objects))
      if (Array.isArray(parsed)) objects = parsed
    } catch {
      // A damaged row reads as an empty template rather than breaking the list.
    }
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      ownerId: String(row.owner_id),
      ownerName: String(row.owner_name),
      createdAt: Number(row.created_at),
      objects,
    }
  }
}
