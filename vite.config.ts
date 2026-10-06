import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The server only accepts changes from pages on its own origin, so the proxy
// must keep the browser's Host header (a bare URL here would rewrite it).
const toServer = { target: 'http://127.0.0.1:1234', changeOrigin: false }

// In dev, the API and sync server runs on its own port (see `npm run dev`) and
// Vite forwards its paths to it, so the client always talks to its own origin.
export default defineConfig({
  plugins: [react()],
  build: {
    // React, Konva and Yjs make one ~700 kB bundle (~220 kB gzipped); fine for a canvas app.
    chunkSizeWarningLimit: 800,
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:1234', ws: true },
      '/api': toServer,
      '/auth': toServer,
      '/media': toServer,
    },
  },
})
