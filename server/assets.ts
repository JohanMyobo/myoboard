import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Images people add to boards, stored per board and named by their content. */

export const MAX_ASSET_BYTES = 10 * 1024 * 1024

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const

type Extension = keyof typeof TYPES

const ASSET_FILE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/

export const isAssetFile = (name: string): boolean => ASSET_FILE.test(name)

export function contentTypeOf(file: string): string {
  return TYPES[path.extname(file).slice(1) as Extension] ?? 'application/octet-stream'
}

/**
 * The format, read from the first bytes rather than trusted from the upload.
 * SVG is not accepted: it can carry scripts.
 */
export function sniffImage(bytes: Uint8Array): Extension | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return null
}

/** Images live in <dataDir>/media/<board>/; boards in memory keep theirs in a temporary folder. */
export class AssetStore {
  constructor(private readonly root: string) {}

  dirFor(board: string): string {
    return path.join(this.root, board)
  }

  pathFor(board: string, file: string): string | null {
    return isAssetFile(file) ? path.join(this.dirFor(board), file) : null
  }

  /** Saves an image and returns its file name, or null if it is not a supported image. */
  save(board: string, bytes: Uint8Array): string | null {
    const ext = sniffImage(bytes)
    if (!ext) return null
    const file = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`
    const target = path.join(this.dirFor(board), file)
    if (!fs.existsSync(target)) {
      fs.mkdirSync(this.dirFor(board), { recursive: true })
      const tmp = `${target}.${process.pid}.tmp`
      fs.writeFileSync(tmp, bytes)
      fs.renameSync(tmp, target)
    }
    return file
  }

  /** Copies an image from one board to another (pasting across boards). */
  copy(from: string, file: string, to: string): string | null {
    const source = this.pathFor(from, file)
    if (!source || !fs.existsSync(source)) return null
    return this.save(to, fs.readFileSync(source))
  }

  removeBoard(board: string): void {
    fs.rmSync(this.dirFor(board), { recursive: true, force: true })
  }
}

/** `/media/<board>/<file>` → its parts, or null. */
export function parseAssetUrl(url: string): { board: string; file: string } | null {
  const match = /^\/media\/([A-Za-z0-9_-]{1,64})\/([^/]+)$/.exec(url)
  return match && isAssetFile(match[2]) ? { board: match[1], file: match[2] } : null
}
