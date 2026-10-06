/** The server's JSON API, as the web app uses it. */

export interface User {
  id: string
  email: string
  name: string
  color: string
}

export type Role = 'owner' | 'editor' | 'viewer'
export type LinkAccess = 'none' | 'view' | 'edit'
export type MemberRole = 'editor' | 'viewer'

export interface AuthInfo {
  mode: 'local' | 'oidc'
  providerName: string | null
}

export interface BoardInfo {
  id: string
  title: string
  ownerId: string
  linkAccess: LinkAccess
  createdAt: number
  updatedAt: number
  owner: { id: string; name: string; email: string } | null
}

export interface Member {
  email: string
  role: MemberRole
  name: string | null
}

export interface BoardAccess {
  board: BoardInfo
  role: Role
  members: Member[]
}

export interface BoardListing {
  id: string
  title: string
  ownerId: string
  ownerName: string
  linkAccess: LinkAccess
  role: Role
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
}

export interface TemplateSummary {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  createdAt: number
  count: number
}

export interface TemplateRecord extends Omit<TemplateSummary, 'count'> {
  objects: unknown[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: Blob; type: string }): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (raw) {
    headers['content-type'] = raw.type || 'application/octet-stream'
    payload = raw.data
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'The server is unreachable. Check your connection.')
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  me: () => request<{ user: User | null; auth: AuthInfo }>('GET', '/api/me'),
  signInLocal: (name: string, email: string) => request<{ user: User }>('POST', '/auth/local', { name, email }),
  signOut: () => request<void>('POST', '/auth/logout'),

  boards: () => request<{ boards: BoardListing[] }>('GET', '/api/boards'),
  createBoard: (input: { title?: string } = {}) => request<BoardAccess>('POST', '/api/boards', input),
  board: (id: string) => request<BoardAccess>('GET', `/api/boards/${id}`),
  setLinkAccess: (id: string, linkAccess: LinkAccess) => request<BoardAccess>('PATCH', `/api/boards/${id}`, { linkAccess }),
  setMember: (id: string, email: string, role: MemberRole) => request<BoardAccess>('PUT', `/api/boards/${id}/members`, { email, role }),
  removeMember: (id: string, email: string) => request<BoardAccess>('DELETE', `/api/boards/${id}/members/${encodeURIComponent(email)}`),
  deleteBoard: (id: string) => request<void>('DELETE', `/api/boards/${id}`),

  uploadImage: (board: string, file: Blob) => request<{ url: string }>('POST', `/api/boards/${board}/assets`, undefined, { data: file, type: file.type }),
  importImage: (board: string, url: string) => request<{ url: string }>('POST', `/api/boards/${board}/assets/import`, { url }),

  templates: () => request<{ templates: TemplateSummary[] }>('GET', '/api/templates'),
  template: (id: string) => request<{ template: TemplateRecord }>('GET', `/api/templates/${id}`),
  saveTemplate: (input: { name: string; description: string; objects: unknown[] }) =>
    request<{ template: TemplateRecord }>('POST', '/api/templates', input),
  deleteTemplate: (id: string) => request<void>('DELETE', `/api/templates/${id}`),

  time: () => request<{ now: number }>('GET', '/api/time'),
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' }
