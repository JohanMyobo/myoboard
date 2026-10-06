import { api } from '../api'

/**
 * The server's clock, as seen from here: shared timers count down the same
 * for everyone even when computers' clocks disagree by a few seconds.
 */

let offset = 0
let synced: Promise<void> | null = null

export function serverNow(): number {
  return Date.now() + offset
}

/** Measures the offset once (half the round trip is the usual estimate). */
export function syncClock(): Promise<void> {
  synced ??= (async () => {
    try {
      const sent = Date.now()
      const { now } = await api.time()
      const received = Date.now()
      offset = now - (sent + received) / 2
    } catch {
      synced = null // try again next time
    }
  })()
  return synced
}
