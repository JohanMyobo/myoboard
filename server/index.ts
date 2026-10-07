import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app'

/**
 * Starts Myoboard: the built web app plus real-time sync, in one process.
 *
 * Options (a flag wins over its environment variable):
 *   --port <n>        PORT      default 3000
 *   --host <address>  HOST      default 0.0.0.0 (every interface); 127.0.0.1 keeps it on this machine
 *   --data-dir <dir>  DATA_DIR  where boards are saved, default ./data
 *   --no-static       run the sync endpoint alone (used by `npm run dev`, where Vite serves the app)
 */

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const port = Number(argValue('--port') ?? process.env.PORT ?? 3000)
const host = argValue('--host') ?? process.env.HOST ?? '0.0.0.0'
const dataDir = path.resolve(argValue('--data-dir') ?? process.env.DATA_DIR ?? 'data')
const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const serveApp = !args.includes('--no-static') && fs.existsSync(path.join(distDir, 'index.html'))

const { server, rooms } = createAppServer({ dataDir, distDir: serveApp ? distDir : null })

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  console.error(`Port ${port} is already in use. Stop the other server, or pick another port: --port ${port + 1}`)
  process.exit(1)
})

server.listen(port, host, () => {
  const where = host === '0.0.0.0' ? 'localhost' : host
  console.log(`Myoboard ${serveApp ? 'app + sync' : 'sync'} server on http://${where}:${port} (boards saved in ${dataDir})`)
})

const shutdown = async () => {
  await rooms.flushAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
