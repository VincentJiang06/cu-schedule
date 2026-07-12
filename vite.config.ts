import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxy /api to the local share server (npm run dev:api, port 8787) so the
// browser stays same-origin. In production nginx does the same (deploy/nginx.conf).
export default defineConfig({
  plugins: [react()],
  // 绝对路径:真路由下深链(如 /timetable)也要能从任意路径下正确加载 /assets/…、
  // favicon、manifest 等静态资源——相对 base 在非根路径下会把资源解析到错误的相对位置。
  base: '/',
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
