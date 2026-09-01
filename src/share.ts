const LIMIT = 28000

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipToUtf8(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip')
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(ds)
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

export async function encodeShare(data: unknown): Promise<string | null> {
  const json = JSON.stringify(data)
  const raw = new TextEncoder().encode(json)
  let payload: string
  if (typeof CompressionStream !== 'undefined') {
    try {
      payload = 'g.' + bytesToB64Url(await gzipBytes(raw))
    } catch {
      payload = 'j.' + bytesToB64Url(raw)
    }
  } else {
    payload = 'j.' + bytesToB64Url(raw)
  }
  if (payload.length > LIMIT) return null
  return payload
}

export async function decodeShare(payload: string): Promise<unknown | null> {
  try {
    let json: string
    if (payload.startsWith('g.')) {
      json = await gunzipToUtf8(b64UrlToBytes(payload.slice(2)))
    } else {
      const body = payload.startsWith('j.') ? payload.slice(2) : payload
      json = new TextDecoder().decode(b64UrlToBytes(body))
    }
    const data = JSON.parse(json) as unknown
    if (!data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

export async function shareUrl(data: unknown): Promise<string | null> {
  const encoded = await encodeShare(data)
  if (!encoded) return null
  return `${location.origin}${location.pathname}${location.search}#s=${encoded}`
}

let bootShare: string | null | undefined

export function peekSharePayload(): string | null {
  if (bootShare === undefined) {
    if (typeof window === 'undefined') {
      bootShare = null
      return null
    }
    const m = location.hash.match(/^#s=(.+)$/)
    bootShare = m ? decodeURIComponent(m[1]) : null
    if (m) history.replaceState(null, '', `${location.pathname}${location.search}`)
  }
  return bootShare
}

export function clearSharePayload() {
  bootShare = null
}
