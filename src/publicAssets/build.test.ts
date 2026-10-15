// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describeAssets, fallbackOrigin, publicAssetFallback } from '../../scripts/publicAssetFallback'
import { Window } from 'happy-dom'

describe('build-time trusted public release', () => {
  it('builds an explicit exit with the original single module and styles, without waiting for a worker', async () => {
    const root = process.cwd()
    const out = path.join(root, '.work', `public-off-test-${Date.now()}`)
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><script type="module" crossorigin src="/builder/assets/index-abcdefgh.js"></script><link rel="stylesheet" href="/builder/assets/index-abcdefgh.css"><link rel="modulepreload" href="/builder/assets/lazy-abcdefgh.js"></head><body><div id="root"></div></body></html>')
    try {
      const plugin = publicAssetFallback(root)
      const config = plugin.configResolved as (value: unknown) => void
      config({ env: { VITE_PUBLIC_ASSET_FALLBACK: 'off' }, base: '/builder/', build: { outDir: out } })
      const write = plugin.writeBundle as (options: unknown, bundle: unknown) => Promise<void>
      await write({}, {})
      const page = new Window({ settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } })
      page.document.write(fs.readFileSync(path.join(out, 'index.html'), 'utf8'))
      expect([...page.document.querySelectorAll('script[type="module"]')].map(node => node.getAttribute('src'))).toEqual(['/builder/assets/index-abcdefgh.js'])
      expect(page.document.querySelectorAll('link[rel="stylesheet"],link[rel="modulepreload"]')).toHaveLength(2)
      const boots = page.document.querySelectorAll('script[data-public-assets-boot="1"]')
      expect(boots).toHaveLength(1)
      expect(boots[0].textContent).toContain('register("/builder/sw.js"')
      for (const forbidden of ['fetch(', 'setTimeout', 'appendChild', 'CacheStorage', 'indexedDB', 'location.reload']) expect(boots[0].textContent).not.toContain(forbidden)
      const descriptor = JSON.parse(fs.readFileSync(path.join(out, 'public-assets-release.json'), 'utf8'))
      expect(descriptor.mode).toBe('public-ipv6-off')
      expect(descriptor.assets).toEqual({})
      expect(descriptor.bootSha256).toBe(createHash('sha256').update(boots[0].textContent).digest('hex'))
      await page.happyDOM.close()
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  })
  it('allows HTTPS origins and explicit preview loopback only, never URL credentials or an arbitrary HTTP server', () => {
    expect(fallbackOrigin('https://v6-test.xiaomaifang.com', false)).toBe('https://v6-test.xiaomaifang.com')
    expect(fallbackOrigin('http://127.0.0.1:21901', true)).toBe('http://127.0.0.1:21901')
    expect(fallbackOrigin('http://localhost:21901', true)).toBe('http://localhost:21901')
    expect(fallbackOrigin('http://[::1]:21901', true)).toBe('http://[::1]:21901')
    for (const url of ['http://127.0.0.1:21901', 'http://example.com', 'https://user:password@example.com',
      'https://example.com/path', 'https://example.com/?x=1', 'https://example.com/#fragment']) {
      expect(() => fallbackOrigin(url, false)).toThrow()
    }
    expect(() => fallbackOrigin('http://example.com', true)).toThrow()
  })

  it('describes only emitted versioned public bytes and build hash assets, rejecting a SHA/path mismatch', () => {
    const out = path.join(process.cwd(), '.work', `public-asset-test-${Date.now()}`)
    fs.mkdirSync(out, { recursive: true })
    const qdf = fs.readFileSync(path.join(process.cwd(), 'public/qdf/A0001.qdf'))
    const hash = createHash('sha256').update(qdf).digest('hex')
    const files = [`resources/${hash}/qdf/A0001.qdf`, 'assets/statsWorker-abcdefgh.js', 'assets/index-abcdefgh.css',
      'assets/font-abcdefgh.woff2', 'qdf/A0001.qdf', 'data/parts.json', 'index.html', 'public-resource-manifest.json', 'assets/plain.js']
    const bundle = Object.fromEntries(files.map(fileName => [fileName, { type: 'asset', fileName }]))
    try {
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true })
        fs.writeFileSync(path.join(out, file), qdf)
      }
      const described = describeAssets(bundle, out)
      expect(Object.keys(described)).toEqual(files.slice(0, 4).map(file => '/builder/' + file).sort())
      expect(described['/builder/' + files[0]]).toEqual({ sha256: hash, size: qdf.length, mime: 'text/plain' })
      fs.writeFileSync(path.join(out, files[0]), 'bad-body')
      expect(() => describeAssets(bundle, out)).toThrow('SHA mismatch')
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  })
})
