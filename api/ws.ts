import { createAppServer } from '../server/app'
import { BlobStore } from '../server/store'

/**
 * Vercel entrypoint: the same HTTP + WebSocket server as `server/index.ts`,
 * minus `listen()` (Vercel calls this handler itself) and with boards saved
 * to Vercel Blob instead of a local disk, which Vercel doesn't keep across
 * requests. `vercel.json` serves the built app as static files and routes
 * only `/ws/*` and `/healthz` here.
 */
const { server } = createAppServer({ distDir: null, store: new BlobStore() })

export default server
