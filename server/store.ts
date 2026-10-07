import fs from 'node:fs'
import path from 'node:path'

/** Where a board's bytes live: a local folder, or a cloud blob store. */
export interface BoardStore {
  load(name: string): Promise<Uint8Array | null>
  save(name: string, data: Uint8Array): Promise<void>
}

/** One file per board, named `<dataDir>/<name>.ybin`. Used for local runs and tests. */
export class FileStore implements BoardStore {
  constructor(private readonly dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  private file(name: string): string {
    return path.join(this.dataDir, `${name}.ybin`)
  }

  async load(name: string): Promise<Uint8Array | null> {
    const file = this.file(name)
    return fs.existsSync(file) ? fs.readFileSync(file) : null
  }

  async save(name: string, data: Uint8Array): Promise<void> {
    // Recreate the folder if something removed it since the last save.
    fs.mkdirSync(this.dataDir, { recursive: true })
    const file = this.file(name)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  }
}

/**
 * One blob per board, for deployments with no writable local disk (Vercel).
 * Needs `@vercel/blob` and a `BLOB_READ_WRITE_TOKEN`; both only on that path,
 * so a local run that never constructs this class needs neither.
 */
export class BlobStore implements BoardStore {
  private readonly prefix: string

  constructor(prefix = 'boards') {
    this.prefix = prefix
  }

  private key(name: string): string {
    return `${this.prefix}/${name}.ybin`
  }

  async load(name: string): Promise<Uint8Array | null> {
    const { head } = await import('@vercel/blob')
    try {
      const blob = await head(this.key(name))
      const res = await fetch(blob.url)
      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      if (err instanceof Error && err.name === 'BlobNotFoundError') return null
      throw err
    }
  }

  async save(name: string, data: Uint8Array): Promise<void> {
    const { put } = await import('@vercel/blob')
    await put(this.key(name), Buffer.from(data), { access: 'public', addRandomSuffix: false })
  }
}
