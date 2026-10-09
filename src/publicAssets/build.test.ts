// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describeAssets, fallbackOrigin } from '../../scripts/publicAssetFallback'

describe('build-time trusted public release', () => {
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
