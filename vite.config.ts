import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

function listJpgIds(dir: string) {
  try {
    return fs.readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.jpg'))
      .map(name => name.replace(/\.jpg$/i, ''))
  } catch {
    return []
  }
}

function readBody(req: import('node:http').IncomingMessage, limit = 2_000_000) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'qinghe-demo-index',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/qinghe-demo' || req.url === '/qinghe-demo/') {
            req.url = '/qinghe-demo/index.html'
          }
          next()
        })
      },
    },
    {
      name: 'thumb-writer',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url?.split('?')[0] || ''
          if (url === '/__thumbs/list' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              official: listJpgIds(path.join(rootDir, 'public/thumbs/official')),
              presets: listJpgIds(path.join(rootDir, 'public/thumbs/presets')),
            }))
            return
          }
          if (url === '/__thumbs/save' && req.method === 'POST') {
            try {
              const raw = await readBody(req)
              const body = JSON.parse(raw.toString('utf8')) as { kind?: string; id?: string; dataUrl?: string }
              const folder = body.kind === 'preset' ? 'presets' : body.kind === 'official' ? 'official' : null
              const id = String(body.id || '')
              const dataUrl = String(body.dataUrl || '')
              if (!folder || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || !dataUrl.startsWith('data:image/jpeg')) {
                res.statusCode = 400
                res.end('bad payload')
                return
              }
              const b64 = dataUrl.split(',')[1]
              if (!b64) {
                res.statusCode = 400
                res.end('no data')
                return
              }
              const dir = path.join(rootDir, 'public/thumbs', folder)
              fs.mkdirSync(dir, { recursive: true })
              fs.writeFileSync(path.join(dir, `${id}.jpg`), Buffer.from(b64, 'base64'))
              res.end('ok')
            } catch {
              res.statusCode = 400
              res.end('save failed')
            }
            return
          }
          next()
        })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Quadro Builder',
        short_name: 'Quadro',
        description: 'QUADRO 攀爬架 3D 设计器',
        theme_color: '#FFF4EB',
        background_color: '#FFF4EB',
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
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
  },
})
