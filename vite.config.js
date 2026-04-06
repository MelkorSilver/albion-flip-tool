import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: "/albion-flip-tool/",
  server: {
    proxy: {
      '/api/albion': {
        target: 'https://europe.albion-online-data.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/albion/, '/api/v2'),
      }
    }
  }
})