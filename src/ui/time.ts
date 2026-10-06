const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const date = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

/** "just now", "5 minutes ago", "yesterday", then a date. */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000)
  if (Math.abs(seconds) < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return relative.format(days, 'day')
  return date.format(at)
}
