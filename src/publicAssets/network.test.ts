// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { fetchPublicAsset, matchPublicAsset } from './network'
import type { AssetRelease } from './protocol'

// 隔离网络夹具验证边界和取消，不代替真实ServiceWorker/IPv6浏览器验收。
const content = new TextEncoder().encode('export const version = 1')
const asset = { sha256: createHash('sha256').update(content).digest('hex'), size: content.length, mime: 'text/javascript' }
const path = '/builder/assets/entry-abcdefgh.js'
const origin = 'https://canonical.example'
const release: AssetRelease = { schemaVersion: 1, mode: 'public-ipv6-fallback', release: 'a'.repeat(64), base: '/builder/',
  ipv6Origin: 'https://ipv6.example', previewOnly: false,
  policy: { fallbackDelayMs: 1000, ipv6TimeoutMs: 2000, totalTimeoutMs: 5000 }, runtimeSha256: 'b'.repeat(64), assets: { [path]: asset } }
const fastRelease = { ...release, policy: { fallbackDelayMs: 10, ipv6TimeoutMs: 20, totalTimeoutMs: 80 } }
const good = () => new Response(content, { headers: { 'Content-Type': 'application/javascript',
  'Content-Encoding': 'gzip', 'Content-Length': '7', 'Set-Cookie': 'must-not-copy=1' } })
const request = () => new Request(origin + path)

describe('exact public resource routing', () => {
  it('admits only exact release GETs, including a worker URL, and never changes private requests', () => {
    expect(matchPublicAsset(request(), origin, release)).toEqual(asset)
    const worker = request()
    Object.defineProperty(worker, 'destination', { value: 'worker' })
    expect(matchPublicAsset(worker, origin, release)).toEqual(asset)
    for (const url of [origin + path + '?retry=1', origin + '/builder/assets/old-abcdefgh.js',
      origin + '/builder/', origin + '/quadro/models/private', origin + '/builder/public-resource-manifest.json',
      origin + '/builder/qdf/A0001.qdf', 'https://foreign.example' + path]) {
      expect(matchPublicAsset(new Request(url), origin, release)).toBeNull()
    }
    for (const headers of [{ Authorization: 'Bearer private' }, { Range: 'bytes=0-10' }] as Record<string, string>[]) {
      expect(matchPublicAsset(new Request(origin + path, { headers }), origin, release)).toBeNull()
    }
    for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
      expect(matchPublicAsset(new Request(origin + path, { method }), origin, release)).toBeNull()
    }
    expect(matchPublicAsset(request(), origin, { ...release, mode: 'public-ipv6-off' })).toBeNull()
  })

  it('returns verified bytes with an empty response URL and trusted MIME, omitting foreign credentials and headers', async () => {
    const calls: Request[] = []
    const result = await fetchPublicAsset(request(), asset, release, async input => {
      calls.push(input as Request)
      return good()
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(release.ipv6Origin + path)
    expect(calls[0].credentials).toBe('omit')
    expect(calls[0].redirect).toBe('error')
    expect(result.url).toBe('')
    expect(result.headers.get('Content-Type')).toBe('text/javascript')
    expect(result.headers.has('Content-Encoding')).toBe(false)
    expect(result.headers.has('Content-Length')).toBe(false)
    expect(result.headers.has('Set-Cookie')).toBe(false)
    expect(await result.text()).toBe(new TextDecoder().decode(content))
  })

  it.each(['network', '404', 'mime', 'sha', 'short', 'oversize'] as const)('falls back to the exact canonical URL after IPv6 %s failure', async failure => {
    const calls: Request[] = []
    const result = await fetchPublicAsset(request(), asset, release, async input => {
      const req = input as Request
      calls.push(req)
      if (req.url.startsWith(origin)) return good()
      if (failure === 'network') throw new TypeError('TLS/DNS/CORS failed')
      if (failure === '404') return new Response('missing', { status: 404 })
      if (failure === 'mime') return new Response(content, { headers: { 'Content-Type': 'text/html' } })
      let bytes = new TextEncoder().encode('export const version = 2')
      if (failure === 'short') bytes = content.slice(0, -1)
      if (failure === 'oversize') bytes = new Uint8Array(content.length + 1)
      return new Response(bytes, { headers: { 'Content-Type': 'text/javascript' } })
    })
    expect(calls.map(call => call.url)).toEqual([release.ipv6Origin + path, origin + path])
    expect(await result.text()).toBe(new TextDecoder().decode(content))
  })

  it('hedges a stalled body, cancels the loser and never publishes late bytes', async () => {
    let canceled = false
    let losingSignal: AbortSignal | undefined
    const calls: string[] = []
    const result = await fetchPublicAsset(request(), asset, fastRelease, async input => {
      const req = input as Request
      calls.push(req.url)
      if (req.url.startsWith(origin)) return good()
      losingSignal = req.signal
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(content.slice(0, 3)) },
        cancel() { canceled = true } }), { headers: { 'Content-Type': 'text/javascript' } })
    })
    expect(calls).toEqual([release.ipv6Origin + path, origin + path])
    expect(losingSignal!.aborted).toBe(true)
    expect(canceled).toBe(true)
    expect(await result.text()).toBe(new TextDecoder().decode(content))
  })

  it('caller abort stops both candidates and does not start a fallback after cancellation', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    const result = fetchPublicAsset(new Request(origin + path, { signal: controller.signal }), asset, release, async input => {
      const req = input as Request
      signals.push(req.signal)
      return new Promise<Response>(() => {})
    })
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
  })

  it('has a hard overall deadline even when a transport ignores abort', async () => {
    const signals: AbortSignal[] = []
    const result = fetchPublicAsset(request(), asset, fastRelease, async input => {
      signals.push((input as Request).signal)
      return new Promise<Response>(() => {})
    })
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(signals).toHaveLength(2)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
})
