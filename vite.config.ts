import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Quadro Builder',
        short_name: 'Quadro',
        description: 'QUADRO 攀爬架 3D 设计器',
        theme_color: '#14120F',
        background_color: '#14120F',
        display: 'standalone',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/mdb-/],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/mdb-files': {
        target: 'https://mdb.quadroworld.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/mdb-files/, '/files'),
      },
      '/mdb-images': {
        target: 'https://mdb.quadroworld.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/mdb-images/, '/images'),
      },
    },
  },
  preview: {
    proxy: {
      '/mdb-files': {
        target: 'https://mdb.quadroworld.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/mdb-files/, '/files'),
      },
      '/mdb-images': {
        target: 'https://mdb.quadroworld.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/mdb-images/, '/images'),
      },
    },
  },
})
