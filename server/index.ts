import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app'
import { GOOGLE_ISSUER, providerNameFor } from './auth'
import type { ProviderSettings } from './auth'

/**
 * Starts Myoboard: the built web app plus real-time sync, in one process.
 *
 * Options (a flag wins over its environment variable):
 *   --port <n>          PORT        default 3000
 *   --host <address>    HOST        default 0.0.0.0 (every interface); 127.0.0.1 keeps it on this machine
 *   --data-dir <dir>    DATA_DIR    where boards, accounts and images are saved, default ./data
 *   --public-url <url>  PUBLIC_URL  the address people use, e.g. https://board.example.com
 *   --no-static         run the API and sync alone (used by `npm run dev`, where Vite serves the app)
 *   --no-env-file       ignore .env (development and tests sign in with a name and an email)
 *
 * Sign-in, each way optional and combinable (README.md, "Sign-in"):
 *   Google          GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and optionally
 *                   GOOGLE_ALLOWED_DOMAINS (only accounts of these Workspace domains)
 *   Other provider  OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (Microsoft, Okta...),
 *                   optionally OIDC_ALLOWED_DOMAINS, OIDC_PROVIDER_NAME, OIDC_ALLOW_HTTP=1
 *   Name and email  LOCAL_SIGN_IN=on|off, on by default when no provider is set:
 *                   nobody checks the address, so keep it for your own machine.
 */

const args = process.argv.slice(2)

// Settings can also live in a git-ignored .env file where the server is
// started; variables already set in the environment win.
const envFile = path.resolve('.env')
if (!args.includes('--no-env-file') && fs.existsSync(envFile)) process.loadEnvFile(envFile)
const env = (name: string) => process.env[name]?.trim() || undefined

const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const port = Number(argValue('--port') ?? env('PORT') ?? 3000)
const host = argValue('--host') ?? env('HOST') ?? '0.0.0.0'
const dataDir = path.resolve(argValue('--data-dir') ?? env('DATA_DIR') ?? 'data')
const publicUrl = argValue('--public-url') ?? env('PUBLIC_URL') ?? null
const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const serveApp = !args.includes('--no-static') && fs.existsSync(path.join(distDir, 'index.html'))

const domains = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
const yes = (value?: string) => /^(1|true|yes|on)$/i.test(value ?? '')

/** A way to sign in needs all its variables, or none; half a setup stops here, saying what is missing. */
function setUp(label: string, vars: Record<string, string | undefined>): boolean {
  const missing = Object.keys(vars).filter((name) => !vars[name])
  if (missing.length === Object.keys(vars).length) return false
  if (missing.length === 0) return true
  console.error(`${label} sign-in is half set up: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty.`)
  console.error(`Fill ${missing.length > 1 ? 'them' : 'it'} in (in .env or the environment), or empty ${Object.keys(vars).join(' and ')} to turn ${label} sign-in off.`)
  process.exit(1)
}

const providers: ProviderSettings[] = []
const google = { GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'), GOOGLE_CLIENT_SECRET: env('GOOGLE_CLIENT_SECRET') }
if (setUp('Google', google)) {
  const allowedDomains = domains(env('GOOGLE_ALLOWED_DOMAINS'))
  providers.push({
    id: 'google',
    name: 'Google',
    issuer: GOOGLE_ISSUER,
    clientId: google.GOOGLE_CLIENT_ID!,
    clientSecret: google.GOOGLE_CLIENT_SECRET!,
    allowedDomains,
    requireHostedDomain: allowedDomains.length > 0,
  })
}
const other = { OIDC_ISSUER: env('OIDC_ISSUER'), OIDC_CLIENT_ID: env('OIDC_CLIENT_ID'), OIDC_CLIENT_SECRET: env('OIDC_CLIENT_SECRET') }
if (setUp('OpenID Connect', other)) {
  const issuer = other.OIDC_ISSUER!
  const allowedDomains = domains(env('OIDC_ALLOWED_DOMAINS'))
  providers.push({
    id: 'oidc',
    name: env('OIDC_PROVIDER_NAME') ?? providerNameFor(issuer),
    issuer,
    clientId: other.OIDC_CLIENT_ID!,
    clientSecret: other.OIDC_CLIENT_SECRET!,
    allowedDomains,
    // Google through these variables gets the same Workspace check.
    requireHostedDomain: issuer.replace(/\/+$/, '') === GOOGLE_ISSUER && allowedDomains.length > 0,
    allowHttp: yes(env('OIDC_ALLOW_HTTP')),
  })
}
const localSetting = env('LOCAL_SIGN_IN')
const localSignIn = localSetting === undefined ? undefined : yes(localSetting)
if (providers.length === 0 && localSignIn === false) {
  console.error('LOCAL_SIGN_IN is off and no provider is set up, so nobody could sign in. Set up Google or OpenID Connect, or turn LOCAL_SIGN_IN on.')
  process.exit(1)
}

const { server, rooms, auth } = createAppServer({
  dataDir,
  distDir: serveApp ? distDir : null,
  auth: { providers, localSignIn, publicUrl },
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  console.error(`Port ${port} is already in use. Stop the other server, or pick another port: --port ${port + 1}`)
  process.exit(1)
})

server.listen(port, host, () => {
  const where = host === '0.0.0.0' ? 'localhost' : host
  console.log(`Myoboard ${serveApp ? 'app + sync' : 'sync'} server on http://${where}:${port} (boards saved in ${dataDir})`)
  const ways = providers.map((p) => `${p.name} (${p.allowedDomains?.length ? p.allowedDomains.join(', ') : 'any account'})`)
  if (auth.info.local) ways.push('name and email')
  console.log(`Sign-in: ${ways.join(', ')}`)
  if (auth.info.local && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn('Name-and-email sign-in lets anyone claim any address. Before sharing this server, set up Google or OpenID Connect and turn LOCAL_SIGN_IN off.')
  }
})

const shutdown = async () => {
  await rooms.flushAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
