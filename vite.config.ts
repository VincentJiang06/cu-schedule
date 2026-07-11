import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxy /api to the local share server (npm run dev:api, port 8787) so the
// browser stays same-origin. In production nginx does the same (deploy/nginx.conf).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
