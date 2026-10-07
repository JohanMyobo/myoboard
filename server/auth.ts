import type { IncomingMessage, ServerResponse } from 'node:http'
import * as oidc from 'openid-client'
import { HttpError, parseCookies, readJson, redirect, requestHost, safeNext, sendJson, serializeCookie } from './http'
import type { Store, User } from './store'

export const SESSION_COOKIE = 'myoboard_session'

export const GOOGLE_ISSUER = 'https://accounts.google.com'

/** One way to sign in through an identity provider (OpenID Connect). */
export interface ProviderSettings {
  /** Short id used in links (`/auth/login?provider=google`). */
  id: string
  /** Shown on the button: "Continue with Google". */
  name: string
  /** e.g. https://accounts.google.com or https://login.microsoftonline.com/<tenant id>/v2.0 */
  issuer: string
  clientId: string
  clientSecret: string
  /** Only these email domains may sign in; empty lets in anyone the provider accepts. */
  allowedDomains?: string[]
  /**
   * Google Workspace: the account must also be managed by one of the allowed
   * domains (the `hd` claim). Without it, a personal Google account opened
   * with a company address would get in.
   */
  requireHostedDomain?: boolean
  /** Accept an http:// issuer: a local identity provider, or the tests. */
  allowHttp?: boolean
}

export interface AuthOptions {
  /** Sign-in through identity providers (Google, Microsoft...), each optional; none by default. */
  providers?: ProviderSettings[]
  /**
   * Name-and-email sign-in, which nobody checks: fine on your own machine.
   * Default: on when there is no provider, off otherwise.
   */
  localSignIn?: boolean
  /** Public address, e.g. https://board.example.com: providers send people back there, and https means secure cookies. */
  publicUrl?: string | null
}

/** The ways to sign in on this server, as the sign-in page shows them. */
export interface AuthInfo {
  local: boolean
  providers: { id: string; name: string }[]
}

interface PendingLogin {
  provider: string
  verifier: string
  nonce: string
  next: string
  expires: number
}

const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_PENDING = 10_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A name for the button, guessed from the issuer when none is given. */
export function providerNameFor(issuer: string): string {
  const host = new URL(issuer).host
  if (host === 'accounts.google.com') return 'Google'
  if (host.endsWith('microsoftonline.com')) return 'Microsoft'
  return 'single sign-on'
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/**
 * Who is signed in, and the ways to sign in. Each identity provider is an
 * optional brick: Google (personal or Workspace accounts), Microsoft or any
 * OpenID Connect provider vouches for the email address. Name-and-email
 * sign-in lets anyone type any address, which is fine on your own machine.
 * The same email is the same account, whichever way it signs in.
 */
export class Auth {
  readonly info: AuthInfo
  private readonly providers: ReadonlyMap<string, ProviderSettings>
  private readonly configs = new Map<string, Promise<oidc.Configuration>>()
  private readonly pending = new Map<string, PendingLogin>()

  constructor(
    private readonly store: Store,
    private readonly options: AuthOptions = {},
  ) {
    const providers = options.providers ?? []
    this.providers = new Map(providers.map((p) => [p.id, p]))
    this.info = {
      local: options.localSignIn ?? providers.length === 0,
      providers: providers.map(({ id, name }) => ({ id, name })),
    }
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
    if (!this.info.local) {
      const names = this.info.providers.map((p) => p.name).join(' or ')
      throw new HttpError(403, `Sign in with ${names}`)
    }
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
    const asked = url.searchParams.get('provider')
    // Without a choice, the only provider is the obvious one.
    const provider = asked ? this.providers.get(asked) : this.providers.size === 1 ? [...this.providers.values()][0] : undefined
    if (!provider) {
      const error = asked ? `&error=${encodeURIComponent('That way of signing in is not set up on this server')}` : ''
      redirect(res, `/login?next=${encodeURIComponent(next)}${error}`)
      return
    }
    const config = await this.configFor(provider)
    const now = Date.now()
    for (const [state, login] of this.pending) {
      if (login.expires < now || this.pending.size > MAX_PENDING) this.pending.delete(state)
    }
    const verifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    this.pending.set(state, { provider: provider.id, verifier, nonce, next, expires: now + PENDING_TTL_MS })
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
    const domains = provider.allowedDomains ?? []
    if (provider.requireHostedDomain && domains.length === 1) params.hd = domains[0]
    redirect(res, oidc.buildAuthorizationUrl(config, params).href)
  }

  private async finishLogin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const fail = (message: string) => redirect(res, `/login?error=${encodeURIComponent(message)}`)
    const state = url.searchParams.get('state') ?? ''
    const login = this.pending.get(state)
    this.pending.delete(state)
    const provider = login ? this.providers.get(login.provider) : undefined
    if (!login || !provider || login.expires < Date.now()) return fail('That sign-in link has expired. Try again.')
    if (url.searchParams.has('error')) return fail(url.searchParams.get('error_description') || 'Sign-in was cancelled')

    let claims: Record<string, unknown> | undefined
    try {
      const config = await this.configFor(provider)
      const current = new URL(url.pathname + url.search, this.baseUrl(req))
      const tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: login.verifier,
        expectedState: state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      })
      claims = tokens.claims() as Record<string, unknown> | undefined
    } catch (err) {
      console.error(`[auth] sign-in with ${provider.name} failed:`, err)
      return fail('Sign-in failed. Try again, or ask whoever runs this server.')
    }

    const email = text(claims?.email) ?? (EMAIL.test(text(claims?.preferred_username) ?? '') ? text(claims?.preferred_username) : undefined)
    if (!email) return fail('Your account has no email address')
    if (claims?.email_verified === false) return fail('Your email address is not verified')
    const domain = email.split('@')[1].toLowerCase()
    const allowed = provider.allowedDomains ?? []
    if (allowed.length > 0 && !allowed.includes(domain)) return fail(`Accounts from ${domain} cannot use this server`)
    if (provider.requireHostedDomain && allowed.length > 0 && !allowed.includes(text(claims?.hd)?.toLowerCase() ?? '')) {
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

  /** One address for every provider: the pending login says which one answers. */
  private callbackUrl(req: IncomingMessage): string {
    return `${this.baseUrl(req)}/auth/callback`
  }

  /** Discovered on first use, and again after a failure (the provider may have been unreachable). */
  private configFor(provider: ProviderSettings): Promise<oidc.Configuration> {
    let config = this.configs.get(provider.id)
    if (!config) {
      config = oidc
        .discovery(new URL(provider.issuer), provider.clientId, provider.clientSecret, undefined, {
          execute: provider.allowHttp ? [oidc.allowInsecureRequests] : [],
        })
        .catch((err: unknown) => {
          this.configs.delete(provider.id)
          console.error(`[auth] could not reach ${provider.name}:`, err)
          throw new HttpError(502, `${provider.name} is unreachable. Try again in a moment.`)
        })
      this.configs.set(provider.id, config)
    }
    return config
  }
}
