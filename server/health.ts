import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Waits until a Myoboard server answers on /healthz: exits 0 once it does,
 * 1 after the timeout. Works the same on every OS, unlike curl.
 *
 *   npm run health                                  127.0.0.1:3000, up to 60 s
 *   npm run health -- --port 4000 --timeout 10
 */

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const port = Number(argValue('--port') ?? process.env.PORT ?? 3000)
const host = argValue('--host') ?? '127.0.0.1'
const timeoutMs = (Number(argValue('--timeout')) || 60) * 1000
const url = `http://${host}:${port}/healthz`

const started = Date.now()
for (;;) {
  try {
    const res = await fetch(url)
    if (res.ok && (await res.text()) === 'ok') {
      console.log(`${url}: ok`)
      process.exit(0)
    }
  } catch {
    // Not listening yet.
  }
  if (Date.now() - started >= timeoutMs) {
    console.error(`${url}: no answer after ${timeoutMs / 1000} s`)
    process.exit(1)
  }
  await sleep(500)
}
