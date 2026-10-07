import type { IncomingMessage, ServerResponse } from 'node:http'

/** Small helpers for the JSON API: no framework, the routes are few. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message })
    return
  }
  console.error('[api]', err)
  sendJson(res, 500, { error: 'Something went wrong on the server' })
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...headers }).end()
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > limit) throw new HttpError(413, 'Too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'Too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Expected JSON')
  const body = await readBody(req, limit)
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8') || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Invalid JSON')
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name || cookies.has(name)) continue
    try {
      cookies.set(name, decodeURIComponent(part.slice(eq + 1).trim()))
    } catch {
      // Ignore a cookie we cannot decode.
    }
  }
  return cookies
}

export function serializeCookie(name: string, value: string, options: { maxAgeSeconds: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${options.maxAgeSeconds}`]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/** The host the browser used, behind a reverse proxy or not. */
export function requestHost(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-host']
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() || req.headers.host || ''
}

/**
 * Requests that change something, and WebSocket upgrades, must come from a
 * page on this server: a browser always sends Origin for those.
 */
export function sameOrigin(req: IncomingMessage, publicUrl: string | null): boolean {
  const origin = req.headers.origin
  if (!origin) return true // not a browser (tests, scripts): cookies are the only credential
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  if (host === requestHost(req)) return true
  return publicUrl !== null && host === new URL(publicUrl).host
}

/** Only paths on this site, so `next` cannot send someone elsewhere after signing in. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
}
