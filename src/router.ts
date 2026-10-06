import { useSyncExternalStore } from 'react'

/** A few routes need no library: the current address, and a way to change it. */

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

window.addEventListener('popstate', notify)

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const current = () => location.pathname + location.search

export function useLocation(): { pathname: string; params: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, current)
  const url = new URL(href, location.origin)
  return { pathname: url.pathname, params: url.searchParams }
}

/** Where to go back to after signing in: only paths on this site. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') && !value.startsWith('/login') ? value : '/'
}
