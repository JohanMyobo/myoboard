import { PEOPLE_COLORS } from '../model/palette'

/** Who you are on a board: shown next to your cursor and on what you create. */
export interface Identity {
  name: string
  color: string
}

const STORAGE_KEY = 'myoboard:identity'

const ADJECTIVES = ['Brave', 'Calm', 'Clever', 'Curious', 'Eager', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lively', 'Quick', 'Sunny', 'Witty', 'Bold', 'Bright']
const ANIMALS = ['Otter', 'Fox', 'Panda', 'Koala', 'Heron', 'Lynx', 'Owl', 'Seal', 'Wren', 'Yak', 'Ibex', 'Mole', 'Puffin', 'Hare', 'Gecko']

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]

export function loadIdentity(): Identity {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (
      stored &&
      typeof stored === 'object' &&
      typeof (stored as Identity).name === 'string' &&
      typeof (stored as Identity).color === 'string'
    ) {
      return stored as Identity
    }
  } catch {
    // Unreadable storage: fall through to a fresh identity.
  }
  const identity = { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(PEOPLE_COLORS) }
  saveIdentity(identity)
  return identity
}

export function saveIdentity(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Storage can be unavailable (private windows); the name then lasts one visit.
  }
}
