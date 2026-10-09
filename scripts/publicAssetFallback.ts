import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, type Plugin, type ResolvedConfig } from 'vite'
import { Window } from 'happy-dom'
import type { AssetBoot, AssetRelease, PublicAsset } from '../src/publicAssets/protocol'

const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const mimeTypes: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.qdf': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }

export function fallbackOrigin(raw: string, previewOnly: boolean): string {
  const url = new URL(raw)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(previewOnly && loopback && url.protocol === 'http:'))) {
    throw new Error('Public asset IPv6 source must be a pure HTTPS origin (loopback HTTP only in explicit preview)')
  }
  return url.origin
}

/** 只使用Vite输出元数据中的hash文件和已有完整SHA版本化public实体。 */
export function describeAssets(bundle: Record<string, { type: string; fileName: string }>, out: string): Record<string, PublicAsset> {
  const assets: Record<string, PublicAsset> = {}
  for (const fileName of Object.keys(bundle).sort()) {
    const hashedBuildAsset = /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/.test(fileName)
    const publicResource = /^resources\/([a-f0-9]{64})\/(?:data\/(?:parts|part-images)\.json|data\/models\/[^/]+\.json|qdf\/[^/]+\.qdf|parts\/[\w/.-]+\.(?:png|jpg|jpeg|webp|svg)|thumbs\/[\w/.-]+\.(?:png|jpg|jpeg|webp))$/.exec(fileName)
    if (!hashedBuildAsset && !publicResource) continue
    const bytes = fs.readFileSync(path.join(out, fileName))
    const sha256 = digest(bytes)
    if (publicResource && publicResource[1] !== sha256) throw new Error(`Public resource path SHA mismatch: ${fileName}`)
    const mime = mimeTypes[path.extname(fileName)]
    if (!mime) throw new Error(`Public asset MIME missing: ${fileName}`)
    assets[`/builder/${fileName}`] = { sha256, size: bytes.length, mime }
  }
  return assets
}

async function compile(root: string, entry: string, define: Record<string, string>): Promise<string> {
  const result = await build({ configFile: false, root, logLevel: 'silent', publicDir: false, define,
    build: { write: false, target: 'es2022', minify: true, rollupOptions: { input: path.join(root, entry),
      output: { format: 'iife', inlineDynamicImports: true } } } })
  const outputs = Array.isArray(result) ? result.flatMap(value => value.output) : 'output' in result ? result.output : []
  const chunk = outputs.find(value => value.type === 'chunk')
  if (!chunk || outputs.length !== 1) throw new Error('Public asset bootstrap must compile to one standalone script')
  return chunk.code
}

export function publicAssetFallback(root: string): Plugin {
  let config: ResolvedConfig
  return {
    name: 'public-asset-ipv6-fallback',
    apply: 'build',
    enforce: 'post',
    configResolved(value) { config = value },
    async writeBundle(_options, bundle) {
      const setting = config.env.VITE_PUBLIC_ASSET_FALLBACK
      if (!setting || setting === '0') return
      if (setting !== '1' && setting !== 'off') throw new Error('Unknown public asset fallback mode')
      if (config.base !== '/builder/') throw new Error('Public asset fallback requires the exact /builder/ base')
      const out = path.resolve(root, config.build.outDir)
      const previewOnly = config.env.VITE_PUBLIC_ASSET_PREVIEW === '1'
      const ipv6Origin = fallbackOrigin(config.env.VITE_PUBLIC_ASSET_IPV6_ORIGIN || 'https://v6-test.xiaomaifang.com', previewOnly)
      const assets = setting === '1' ? describeAssets(bundle, out) : {}
      const data = { schemaVersion: 1 as const, mode: setting === '1' ? 'public-ipv6-fallback' as const : 'public-ipv6-off' as const,
        base: '/builder/' as const, ipv6Origin, previewOnly, policy: { fallbackDelayMs: 1000, ipv6TimeoutMs: 4000, totalTimeoutMs: 60000 }, assets }
      const release: AssetRelease = { ...data, release: digest(JSON.stringify(data)) }
      const page = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })
      page.document.write(fs.readFileSync(path.join(out, 'index.html'), 'utf8'))
      const document = page.document
      const entries = Array.from(document.querySelectorAll('script[type="module"][src]'))
      if (entries.length !== 1) throw new Error('Expected exactly one application module entry')
      const entry = entries[0].getAttribute('src')!
      const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link => link.getAttribute('href')!)
      if (setting === '1' && (!assets[entry] || styles.some(url => !assets[url]))) throw new Error('Entry/styles absent from exact public asset release')
      entries[0].remove()
      for (const link of document.querySelectorAll('link[rel="stylesheet"],link[rel="modulepreload"]')) link.remove()
      const boot: AssetBoot = { protocol: 1, release: release.release, mode: release.mode, base: '/builder/', entry, styles, controllerBudgetMs: 1200 }
      const workerCode = await compile(root, 'src/publicAssets/worker.ts', { __PUBLIC_ASSET_RELEASE__: JSON.stringify(release) })
      const bootCode = await compile(root, 'src/publicAssets/boot.ts', { __PUBLIC_ASSET_BOOT__: JSON.stringify(boot) })
      const script = document.createElement('script')
      script.setAttribute('data-public-assets-boot', '1')
      script.setAttribute('data-release', release.release)
      script.textContent = bootCode
      document.body.append(script)
      fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html>\n' + document.documentElement.outerHTML)
      const worker = `/* xmf-public-assets:v1 release=${release.release} mode=${release.mode} */\n${workerCode}`
      fs.writeFileSync(path.join(out, 'public-assets-release.json'), JSON.stringify({ ...release, workerSha256: digest(worker), bootSha256: digest(bootCode) }))
      fs.writeFileSync(path.join(out, 'public-assets-sw.js'), worker)
      const off = { ...release, mode: 'public-ipv6-off', assets: {} }
      fs.writeFileSync(path.join(out, 'public-assets-off.js'), await compile(root, 'src/publicAssets/worker.ts', { __PUBLIC_ASSET_RELEASE__: JSON.stringify(off) }))
      console.info(`[public assets] ${Object.keys(assets).length} exact files; SW ${workerCode.length} bytes / gzip ${gzipSync(workerCode).length}; release ${release.release}`)
      await page.happyDOM.close()
    },
  }
}
