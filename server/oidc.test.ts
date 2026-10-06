import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, startApp } from './test-helpers'
import type { Running } from './test-helpers'

/**
 * A tiny OpenID Connect provider: discovery, keys, an authorize endpoint that
 * signs in straight away, and a token endpoint that checks PKCE and the client
 * secret before issuing a signed ID token.
 */
async function startProvider(claims: () => Record<string, unknown>) {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { nonce: string; challenge: string }>()
  let issuer = ''

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    const json = (body: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/authorize') {
      const code = crypto.randomBytes(16).toString('hex')
      codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '' })
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      return res.writeHead(302, { location: back.href }).end()
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const form = new URLSearchParams(body)
      const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString()
      const [id, secret] = basic ? basic.split(':').map(decodeURIComponent) : [form.get('client_id'), form.get('client_secret')]
      if (id !== 'myoboard' || secret !== 'top-secret') return json({ error: 'invalid_client' }, 401)
      const grant = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      const verifier = form.get('code_verifier') ?? ''
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      if (!grant || grant.challenge !== challenge) return json({ error: 'invalid_grant' }, 400)
      const idToken = await new SignJWT({ nonce: grant.nonce, ...claims() })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience('myoboard')
        .setSubject('user-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      return json({ access_token: 'access', token_type: 'Bearer', expires_in: 300, id_token: idToken })
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { issuer, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** Follows the sign-in redirects like a browser would, and returns where it ends up and the cookie set. */
async function signInThroughProvider(base: string, next = '/b/some-board', provider?: string) {
  const pick = provider ? `&provider=${provider}` : ''
  const start = await fetch(`${base}/auth/login?next=${encodeURIComponent(next)}${pick}`, { redirect: 'manual' })
  expect(start.status).toBe(302)
  const atProvider = await fetch(start.headers.get('location')!, { redirect: 'manual' })
  const callback = await fetch(atProvider.headers.get('location')!, { redirect: 'manual' })
  return { location: callback.headers.get('location') ?? '', cookie: callback.headers.get('set-cookie')?.split(';')[0] ?? null }
}

describe('single sign-on (OpenID Connect)', () => {
  let provider: Awaited<ReturnType<typeof startProvider>>
  let running: Running
  let claims: Record<string, unknown>

  beforeEach(async () => {
    claims = { email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace' }
    provider = await startProvider(() => claims)
    running = await startApp({
      auth: {
        providers: [
          { id: 'sso', name: 'Example SSO', issuer: provider.issuer, clientId: 'myoboard', clientSecret: 'top-secret', allowHttp: true, allowedDomains: ['example.com'] },
        ],
      },
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await running.close()
    await provider.close()
  })

  it('signs people in with the provider and sends them back where they were going', async () => {
    const { location, cookie } = await signInThroughProvider(running.base, '/b/some-board')
    expect(location).toBe('/b/some-board')
    const me = await call(running.base, cookie, 'GET', '/api/me')
    expect(me.json).toMatchObject({ user: { email: 'ada@example.com', name: 'Ada Lovelace' }, auth: { local: false, providers: [{ id: 'sso', name: 'Example SSO' }] } })
  })

  it('uses the Microsoft-style preferred_username when there is no email claim', async () => {
    claims = { preferred_username: 'grace@example.com', name: 'Grace Hopper' }
    const { cookie } = await signInThroughProvider(running.base)
    expect((await call(running.base, cookie, 'GET', '/api/me')).json.user).toMatchObject({ email: 'grace@example.com' })
  })

  it('turns away accounts from other domains', async () => {
    claims = { email: 'mallory@elsewhere.example', email_verified: true, name: 'Mallory' }
    const { location, cookie } = await signInThroughProvider(running.base)
    expect(location).toMatch(/^\/login\?error=/)
    expect(decodeURIComponent(location)).toContain('elsewhere.example')
    expect(cookie).toBeNull()
  })

  it('refuses a callback it did not start', async () => {
    const forged = await fetch(`${running.base}/auth/callback?code=abc&state=forged`, { redirect: 'manual' })
    expect(forged.headers.get('location')).toMatch(/^\/login\?error=/)
    expect(forged.headers.get('set-cookie')).toBeNull()
  })

  it('turns name-and-email sign-in off once a provider is set up', async () => {
    const res = await call(running.base, null, 'POST', '/auth/local', { name: 'Eve', email: 'eve@example.com' })
    expect(res.status).toBe(403)
  })

  it('refuses a provider that is not set up', async () => {
    const res = await fetch(`${running.base}/auth/login?provider=nope`, { redirect: 'manual' })
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('not set up')
  })

  it('never sends people to another site after signing in', async () => {
    const { location } = await signInThroughProvider(running.base, '//evil.example/steal')
    expect(location).toBe('/')
  })
})

describe('single sign-on with Google Workspace', () => {
  let provider: Awaited<ReturnType<typeof startProvider>>
  let running: Running
  let claims: Record<string, unknown>

  beforeEach(async () => {
    claims = { email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace', hd: 'example.com' }
    provider = await startProvider(() => claims)
    running = await startApp({
      auth: {
        providers: [
          {
            id: 'google',
            name: 'Google',
            issuer: provider.issuer,
            clientId: 'myoboard',
            clientSecret: 'top-secret',
            allowHttp: true,
            allowedDomains: ['example.com'],
            requireHostedDomain: true,
          },
        ],
      },
    })
  })

  afterEach(async () => {
    await running.close()
    await provider.close()
  })

  it('lets in accounts the company manages', async () => {
    const { location, cookie } = await signInThroughProvider(running.base)
    expect(location).toBe('/b/some-board')
    expect((await call(running.base, cookie, 'GET', '/api/me')).json.user).toMatchObject({ email: 'ada@example.com' })
  })

  it('turns away a personal Google account that uses a company address', async () => {
    claims = { email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace' } // no hd: not managed by the company
    const { location, cookie } = await signInThroughProvider(running.base)
    expect(decodeURIComponent(location)).toContain('work account')
    expect(cookie).toBeNull()
  })

  it('asks Google to offer only the company accounts', async () => {
    const start = await fetch(`${running.base}/auth/login`, { redirect: 'manual' })
    expect(new URL(start.headers.get('location')!).searchParams.get('hd')).toBe('example.com')
  })
})

describe('several ways to sign in at once', () => {
  let work: Awaited<ReturnType<typeof startProvider>>
  let other: Awaited<ReturnType<typeof startProvider>>
  let running: Running

  beforeEach(async () => {
    work = await startProvider(() => ({ email: 'ada@example.com', email_verified: true, name: 'Ada at work', hd: 'example.com' }))
    other = await startProvider(() => ({ email: 'ada@personal.example', email_verified: true, name: 'Ada at home' }))
    const settings = (id: string, name: string, issuer: string) => ({ id, name, issuer, clientId: 'myoboard', clientSecret: 'top-secret', allowHttp: true })
    running = await startApp({
      auth: {
        providers: [settings('google', 'Google', work.issuer), settings('oidc', 'Microsoft', other.issuer)],
        localSignIn: true,
      },
    })
  })

  afterEach(async () => {
    await running.close()
    await work.close()
    await other.close()
  })

  it('offers every way that is set up, name and email included when asked', async () => {
    const me = await call(running.base, null, 'GET', '/api/me')
    expect(me.json.auth).toEqual({ local: true, providers: [{ id: 'google', name: 'Google' }, { id: 'oidc', name: 'Microsoft' }] })
    expect((await call(running.base, null, 'POST', '/auth/local', { name: 'Eve', email: 'eve@example.com' })).status).toBe(200)
  })

  it('signs in through the provider picked, all with one callback address', async () => {
    const first = await signInThroughProvider(running.base, '/', 'google')
    expect((await call(running.base, first.cookie, 'GET', '/api/me')).json.user).toMatchObject({ email: 'ada@example.com' })
    const second = await signInThroughProvider(running.base, '/', 'oidc')
    expect((await call(running.base, second.cookie, 'GET', '/api/me')).json.user).toMatchObject({ email: 'ada@personal.example' })
  })

  it('sends people to the sign-in page to choose when no provider is named', async () => {
    const res = await fetch(`${running.base}/auth/login?next=/b/x`, { redirect: 'manual' })
    expect(res.headers.get('location')).toBe('/login?next=%2Fb%2Fx')
  })
})
