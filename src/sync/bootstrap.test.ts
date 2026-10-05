import { afterEach, expect, it, vi } from 'vitest'
import type { SyncEvent } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.doUnmock('./index')
  vi.doUnmock('../engine-api')
  vi.doUnmock('../analytics/track')
  vi.resetModules()
})

it('首次UI订阅回放启动期警告，即使后续idle已覆盖最近事件，且只回放一次', async () => {
  vi.resetModules()
  vi.stubEnv('VITE_SYNC_BASE', '/quadro')
  vi.stubGlobal('sessionStorage', { removeItem: vi.fn(), getItem: vi.fn(), setItem: vi.fn() })
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' })
  vi.stubGlobal('window', { addEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ userId: '123' }))))
  vi.doMock('../engine-api', () => ({ storage: { setAccountScope: vi.fn() } }))
  vi.doMock('../analytics/track', () => ({ track: vi.fn() }))
  const warnings: SyncEvent[] = [
    { type: 'legacy-deletion', id: 'old' },
    { type: 'quota', feature: 'designs', used: 2, limit: 2 },
    { type: 'error', error: new Error('network unavailable') },
  ]
  vi.doMock('./index', () => ({ QuotaError: class extends Error {}, createSync: ({ onEvent }: { onEvent: (event: SyncEvent) => void }) => ({
    start: () => { warnings.forEach(onEvent); onEvent({ type: 'idle', rev: 3 }) },
    stop: vi.fn(), syncNow: vi.fn(), syncSavedDoc: vi.fn(),
  }) }))
  const bootstrap = await import('./bootstrap')
  bootstrap.startSyncIfConfigured()
  expect(await bootstrap.syncProbe()).toBe(true)
  const first: SyncEvent[] = []
  const stop = bootstrap.onSyncEvent(event => first.push(event))
  expect(first).toEqual([...warnings, { type: 'idle', rev: 3 }])
  stop()
  const second: SyncEvent[] = []
  bootstrap.onSyncEvent(event => second.push(event))()
  expect(second).toEqual([{ type: 'idle', rev: 3 }])
})
