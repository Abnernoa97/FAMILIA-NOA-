import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: process.env.CF_PAGES || process.env.CLOUDFLARE ? '/' : (process.env.GITHUB_ACTIONS ? '/FAMILIA-NOA-/' : '/'),
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
})
