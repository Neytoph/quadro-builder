import type { AssetRelease, PublicAsset } from './protocol'

/** 仅当前发布的精确URL；所有附加参数及带私有语义的请求按原请求处理。 */
export function matchPublicAsset(request: Request, origin: string, release: AssetRelease): PublicAsset | null {
  if (release.mode !== 'public-ipv6-fallback' || request.method !== 'GET' || request.mode === 'navigate'
    || request.destination === 'document' || request.headers.has('Authorization') || request.headers.has('Range')) return null
  const url = new URL(request.url)
  if (url.origin !== origin || url.search || url.hash || !url.pathname.startsWith(release.base)) return null
  return Object.hasOwn(release.assets, url.pathname) ? release.assets[url.pathname] : null
}

function validMime(actual: string | null, expected: string): boolean {
  const mime = (actual || '').split(';')[0].trim().toLowerCase()
  if (expected === 'text/javascript') return mime === expected || mime === 'application/javascript'
  if (expected === 'text/plain') return mime === expected || mime === 'application/octet-stream'
  return mime === expected
}

/** 流读取含大小上限；不相信压缩Content-Length，也不保留外源Response.url和headers。 */
async function verifiedBytes(response: Response, asset: PublicAsset, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (response.status !== 200 || response.redirected || response.type === 'opaque'
    || !validMime(response.headers.get('Content-Type'), asset.mime) || !response.body) {
    await response.body?.cancel()
    throw new Error('public asset response rejected')
  }
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const bytes = new Uint8Array(asset.size)
  let offset = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > bytes.byteLength) throw new Error('public asset body exceeds release size')
      bytes.set(value, offset)
      offset += value.byteLength
    }
    if (offset !== bytes.byteLength) throw new Error('public asset body is incomplete')
    signal.throwIfAborted()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    signal.throwIfAborted()
    const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== asset.sha256) throw new Error('public asset SHA-256 mismatch')
    return bytes
  } catch (error) {
    void reader.cancel(error).catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/** IPv6先发，canonical有界并行；只有完整校验后的胜者可以交付。 */
export function fetchPublicAsset(request: Request, asset: PublicAsset, release: AssetRelease,
  fetcher: typeof fetch = fetch): Promise<Response> {
  return new Promise((resolve, reject) => {
    const ipv6 = new AbortController()
    const canonical = new AbortController()
    let settled = false
    let canonicalStarted = false
    let failed = 0
    const errors: unknown[] = []
    let fallbackTimer: ReturnType<typeof setTimeout>
    let ipv6Timer: ReturnType<typeof setTimeout>
    let totalTimer: ReturnType<typeof setTimeout>
    const clean = () => {
      clearTimeout(fallbackTimer)
      clearTimeout(ipv6Timer)
      clearTimeout(totalTimer)
      request.signal.removeEventListener('abort', abort)
      ipv6.abort()
      canonical.abort()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clean()
      reject(error)
    }
    const abort = () => fail(request.signal.reason || new DOMException('Aborted', 'AbortError'))
    const run = async (url: string, controller: AbortController, foreign: boolean) => {
      try {
        const response = await fetcher(foreign ? new Request(url, { mode: 'cors', credentials: 'omit',
          redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal })
          : new Request(request, { signal: controller.signal, redirect: 'error' }))
        const bytes = await verifiedBytes(response, asset, controller.signal)
        if (settled) return
        settled = true
        clean()
        resolve(new Response(bytes, { status: 200, headers: {
          'Content-Type': asset.mime,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=31536000, immutable',
        } }))
      } catch (error) {
        if (settled) return
        errors.push(error)
        failed++
        if (foreign) startCanonical()
        if (failed === 2) fail(new AggregateError(errors, 'Both public asset sources failed'))
      }
    }
    const startCanonical = () => {
      if (canonicalStarted || settled || request.signal.aborted) return
      canonicalStarted = true
      clearTimeout(fallbackTimer)
      void run(request.url, canonical, false)
    }
    if (request.signal.aborted) { abort(); return }
    request.signal.addEventListener('abort', abort, { once: true })
    fallbackTimer = setTimeout(startCanonical, release.policy.fallbackDelayMs)
    ipv6Timer = setTimeout(() => { ipv6.abort(); startCanonical() }, release.policy.ipv6TimeoutMs)
    totalTimer = setTimeout(() => fail(new DOMException('Public asset download timed out', 'TimeoutError')), release.policy.totalTimeoutMs)
    const url = new URL(request.url)
    void run(`${release.ipv6Origin}${url.pathname}`, ipv6, true)
  })
}
