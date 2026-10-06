import type { IncomingMessage, ServerResponse } from 'node:http'
import * as oidc from 'openid-client'
import { HttpError, parseCookies, readJson, redirect, requestHost, safeNext, sendJson, serializeCookie } from './http'
import type { Store, User } from './store'

export const SESSION_COOKIE = 'myoboard_session'

export interface OidcOptions {
  /** e.g. https://accounts.google.com or https://login.microsoftonline.com/<tenant id>/v2.0 */
  issuer: string
  clientId: string
  clientSecret: string
  /** Shown on the sign-in button ("Continue with Google"); guessed from the issuer otherwise. */
  providerName?: string
  /** Only these email domains may sign in; empty lets in anyone the provider accepts. */
  allowedDomains?: string[]
  /**
   * Google Workspace: also require the account to be managed by one of the
   * allowed domains (the `hd` claim). Without it, a personal Google account
   * opened with a company address would get in. On by default for Google
   * when allowed domains are set.
   */
  requireHostedDomain?: boolean
  /** Accept an http:// issuer: a local identity provider, or the tests. */
  allowHttp?: boolean
}

export interface AuthOptions {
  /** Sign in through an OpenID Connect provider; without it, people just type a name and an email. */
  oidc?: OidcOptions | null
  /** Public address, e.g. https://board.example.com: the OIDC redirect goes there, and https means secure cookies. */
  publicUrl?: string | null
}

export interface AuthInfo {
  mode: 'local' | 'oidc'
  providerName: string | null
}

const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_PENDING = 10_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function providerNameFor(issuer: string): string {
  const host = new URL(issuer).host
  if (host === 'accounts.google.com') return 'Google'
  if (host.endsWith('microsoftonline.com')) return 'Microsoft'
  return 'single sign-on'
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/**
 * Who is signed in. In OIDC mode the company's identity provider (Google,
 * Microsoft or any other) vouches for the email address; in local mode,
 * anyone can type any name and email, which is fine on your own machine only.
 */
export class Auth {
  readonly info: AuthInfo
  private readonly hostedDomain: boolean
  private config: Promise<oidc.Configuration> | null = null
  private readonly pending = new Map<string, { verifier: string; nonce: string; next: string; expires: number }>()

  constructor(
    private readonly store: Store,
    private readonly options: AuthOptions = {},
  ) {
    const settings = options.oidc
    this.info = settings
      ? { mode: 'oidc', providerName: settings.providerName || providerNameFor(settings.issuer) }
      : { mode: 'local', providerName: null }
    const domains = settings?.allowedDomains ?? []
    this.hostedDomain = !!settings && domains.length > 0 && (settings.requireHostedDomain ?? new URL(settings.issuer).host === 'accounts.google.com')
  }

  get publicUrl(): string | null {
    return this.options.publicUrl ?? null
  }

  userFromRequest(req: IncomingMessage): User | undefined {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE)
    return token ? this.store.userForSession(token) : undefined
  }

  /** Handles /auth/*. Returns false for any other path. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    switch (url.pathname) {
      case '/auth/local':
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
        await this.localSignIn(req, res)
        return true
      case '/auth/login':
        await this.startLogin(req, res, url)
        return true
      case '/auth/callback':
        await this.finishLogin(req, res, url)
        return true
      case '/auth/logout': {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
        const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE)
        if (token) this.store.deleteSession(token)
        res.writeHead(204, { 'set-cookie': this.cookie(req, '', 0) }).end()
        return true
      }
      default:
        return false
    }
  }

  private async localSignIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.info.mode !== 'local') throw new HttpError(403, `Sign in with ${this.info.providerName}`)
    const body = await readJson(req)
    const email = text(body.email)
    const name = text(body.name)
    if (!email || !EMAIL.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address')
    if (!name) throw new HttpError(400, 'Enter your name')
    const user = this.store.upsertUser({ email, name })
    this.startSession(req, res, user)
    sendJson(res, 200, { user })
  }

  private async startLogin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const next = safeNext(url.searchParams.get('next'))
    if (this.info.mode === 'local') {
      redirect(res, `/login?next=${encodeURIComponent(next)}`)
      return
    }
    const config = await this.oidcConfig()
    const now = Date.now()
    for (const [state, login] of this.pending) {
      if (login.expires < now || this.pending.size > MAX_PENDING) this.pending.delete(state)
    }
    const verifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    this.pending.set(state, { verifier, nonce, next, expires: now + PENDING_TTL_MS })
    const params: Record<string, string> = {
      redirect_uri: this.callbackUrl(req),
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    }
    // Google then only offers the company's accounts (a hint; the check is below).
    const domains = this.options.oidc?.allowedDomains ?? []
    if (this.hostedDomain && domains.length === 1) params.hd = domains[0]
    const target = oidc.buildAuthorizationUrl(config, params)
    redirect(res, target.href)
  }

  private async finishLogin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const fail = (message: string) => redirect(res, `/login?error=${encodeURIComponent(message)}`)
    if (this.info.mode !== 'oidc') return fail('Single sign-on is not set up on this server')
    const state = url.searchParams.get('state') ?? ''
    const login = this.pending.get(state)
    this.pending.delete(state)
    if (!login || login.expires < Date.now()) return fail('That sign-in link has expired. Try again.')
    if (url.searchParams.has('error')) return fail(url.searchParams.get('error_description') || 'Sign-in was cancelled')

    let claims: Record<string, unknown> | undefined
    try {
      const config = await this.oidcConfig()
      const current = new URL(url.pathname + url.search, this.baseUrl(req))
      const tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: login.verifier,
        expectedState: state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      })
      claims = tokens.claims() as Record<string, unknown> | undefined
    } catch (err) {
      console.error('[auth] sign-in failed:', err)
      return fail('Sign-in failed. Try again, or ask whoever runs this server.')
    }

    const email = text(claims?.email) ?? (EMAIL.test(text(claims?.preferred_username) ?? '') ? text(claims?.preferred_username) : undefined)
    if (!email) return fail('Your account has no email address')
    if (claims?.email_verified === false) return fail('Your email address is not verified')
    const domain = email.split('@')[1].toLowerCase()
    const allowed = this.options.oidc?.allowedDomains ?? []
    if (allowed.length > 0 && !allowed.includes(domain)) return fail(`Accounts from ${domain} cannot use this server`)
    if (this.hostedDomain && !allowed.includes(text(claims?.hd)?.toLowerCase() ?? '')) {
      return fail(`Sign in with your ${allowed.join(' or ')} work account, not a personal one`)
    }
    const name = text(claims?.name) ?? ([text(claims?.given_name), text(claims?.family_name)].filter(Boolean).join(' ') || email.split('@')[0])

    const user = this.store.upsertUser({ email, name })
    this.startSession(req, res, user)
    redirect(res, login.next)
  }

  private startSession(req: IncomingMessage, res: ServerResponse, user: User): void {
    const { token, expiresAt } = this.store.createSession(user.id)
    res.setHeader('set-cookie', this.cookie(req, token, Math.floor((expiresAt - Date.now()) / 1000)))
  }

  private cookie(req: IncomingMessage, value: string, maxAgeSeconds: number): string {
    const secure = this.baseUrl(req).startsWith('https:')
    return serializeCookie(SESSION_COOKIE, value, { maxAgeSeconds, secure })
  }

  private baseUrl(req: IncomingMessage): string {
    if (this.publicUrl) return this.publicUrl.replace(/\/+$/, '')
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
    return `${proto}://${requestHost(req)}`
  }

  private callbackUrl(req: IncomingMessage): string {
    return `${this.baseUrl(req)}/auth/callback`
  }

  /** Discovered on first use, and again after a failure (the provider may have been unreachable). */
  private oidcConfig(): Promise<oidc.Configuration> {
    const settings = this.options.oidc
    if (!settings) throw new HttpError(500, 'OIDC is not configured')
    if (!this.config) {
      this.config = oidc
        .discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, {
          execute: settings.allowHttp ? [oidc.allowInsecureRequests] : [],
        })
        .catch((err: unknown) => {
          this.config = null
          console.error('[auth] could not reach the identity provider:', err)
          throw new HttpError(502, 'The sign-in provider is unreachable. Try again in a moment.')
        })
    }
    return this.config
  }
}
