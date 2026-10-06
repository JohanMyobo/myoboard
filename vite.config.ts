import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the sync server runs on its own port (see `npm run dev`) and Vite
// forwards /ws to it, so the client always connects to `<host>/ws`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:1234', ws: true },
    },
  },
})
