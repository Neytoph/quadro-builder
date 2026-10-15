import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export function publicResources(root: string, emitAssets = true): Plugin {
  const resources: Record<string, { hash: string; url: string }> = {}
  const files = new Map<string, Buffer>()
  const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  }).sort()
  for (const file of walk(path.join(root, 'public'))) {
    const logical = path.relative(path.join(root, 'public'), file).split(path.sep).join('/')
    if (!/^(?:data\/(?:parts|part-images)\.json|data\/models\/[^/]+\.json|qdf\/[^/]+\.qdf|parts\/[\w/.-]+\.(?:png|jpg|jpeg|webp|svg)|thumbs\/[\w/.-]+\.(?:png|jpg|jpeg|webp))$/.test(logical)) continue
    const source = fs.readFileSync(file)
    const hash = digest(source)
    const url = `resources/${hash}/${logical}`
    resources[logical] = { hash, url }
    files.set(url, source)
  }
  const engineSource = walk(path.join(root, 'src/engine')).filter(file => file.endsWith('.js'))
    .map(file => `${path.relative(root, file)}\n${fs.readFileSync(file, 'utf8')}`).join('\n')
  const engineVersion = digest(engineSource + fs.readFileSync(path.join(root, 'src/designStats.ts'), 'utf8')
    + fs.readFileSync(path.join(root, 'public/data/parts.json'), 'utf8'))
  const manifest = { schemaVersion: 1, engineVersion, resources }
  return {
    name: 'public-content-resources',
    resolveId(id) { if (id === 'virtual:public-resources') return '\0public-resources' },
    load(id) { if (id === '\0public-resources') return `export default ${JSON.stringify(manifest)}` },
    generateBundle() {
      if (!emitAssets) return
      for (const [fileName, source] of files) this.emitFile({ type: 'asset', fileName, source })
      this.emitFile({ type: 'asset', fileName: 'public-resource-manifest.json', source: JSON.stringify(manifest) })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const logical = (req.url || '').split('?')[0].replace(/^\//, '')
        const source = files.get(logical)
        if (!source) { next(); return }
        const extension = path.extname(logical).slice(1)
        const types: Record<string, string> = { json: 'application/json', qdf: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }
        res.setHeader('Content-Type', types[extension] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.end(source)
      })
    },
  }
}
