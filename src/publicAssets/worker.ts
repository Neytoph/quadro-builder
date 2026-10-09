import { fetchPublicAsset, matchPublicAsset } from './network'
import { HELLO, READY, type AssetRelease } from './protocol'

declare const __PUBLIC_ASSET_RELEASE__: AssetRelease

interface WorkerScope {
  location: Location
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  addEventListener(type: 'install' | 'activate', handler: (event: { waitUntil(value: Promise<unknown>): void }) => void): void
  addEventListener(type: 'fetch', handler: (event: { request: Request; respondWith(value: Promise<Response>): void }) => void): void
  addEventListener(type: 'message', handler: (event: { data: unknown; ports: readonly MessagePort[] }) => void): void
}

const worker = self as unknown as WorkerScope
const release = __PUBLIC_ASSET_RELEASE__
worker.addEventListener('install', event => event.waitUntil(worker.skipWaiting()))
worker.addEventListener('activate', event => event.waitUntil(worker.clients.claim()))
worker.addEventListener('message', event => {
  const data = event.data as { type?: unknown; protocol?: unknown; release?: unknown } | null
  if (data?.type !== HELLO || data.protocol !== 1 || data.release !== release.release) return
  event.ports[0]?.postMessage({ type: READY, protocol: 1, release: release.release, mode: release.mode })
})
worker.addEventListener('fetch', event => {
  const asset = matchPublicAsset(event.request, worker.location.origin, release)
  if (asset) event.respondWith(fetchPublicAsset(event.request, asset, release))
})
