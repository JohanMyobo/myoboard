import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app'

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
 * Sign-in with the company's accounts (OpenID Connect: Google, Microsoft...):
 *   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and optionally
 *   OIDC_ALLOWED_DOMAINS (comma-separated), OIDC_PROVIDER_NAME, OIDC_ALLOW_HTTP=1.
 * Without them, people sign in with just a name and an email: local use only.
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

const issuer = env('OIDC_ISSUER')
const clientId = env('OIDC_CLIENT_ID')
const clientSecret = env('OIDC_CLIENT_SECRET')
if ((issuer || clientId || clientSecret) && !(issuer && clientId && clientSecret)) {
  const missing = Object.entries({ OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  console.error(`Single sign-on is half set up: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty.`)
  console.error('Fill them in (in .env or the environment), or empty all three OIDC_ variables to sign in with a name and an email.')
  process.exit(1)
}
const oidc =
  issuer && clientId && clientSecret
    ? {
        issuer,
        clientId,
        clientSecret,
        providerName: env('OIDC_PROVIDER_NAME'),
        allowedDomains: (env('OIDC_ALLOWED_DOMAINS') ?? '')
          .split(',')
          .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
          .filter(Boolean),
        allowHttp: /^(1|true|yes)$/i.test(env('OIDC_ALLOW_HTTP') ?? ''),
      }
    : null

const { server, rooms } = createAppServer({ dataDir, distDir: serveApp ? distDir : null, auth: { oidc, publicUrl } })

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  console.error(`Port ${port} is already in use. Stop the other server, or pick another port: --port ${port + 1}`)
  process.exit(1)
})

server.listen(port, host, () => {
  const where = host === '0.0.0.0' ? 'localhost' : host
  console.log(`Myoboard ${serveApp ? 'app + sync' : 'sync'} server on http://${where}:${port} (boards saved in ${dataDir})`)
  if (oidc) {
    console.log(`Sign-in: ${new URL(oidc.issuer).host}${oidc.allowedDomains.length ? `, for ${oidc.allowedDomains.join(', ')}` : ''}`)
    if (oidc.allowedDomains.length === 0) console.warn('Sign-in: OIDC_ALLOWED_DOMAINS is empty, so any account the provider accepts gets in.')
  } else if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn('Sign-in: name and email only, which anyone can make up. Set OIDC_* to use your company accounts before sharing this server.')
  }
})

const shutdown = () => {
  rooms.flushAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
