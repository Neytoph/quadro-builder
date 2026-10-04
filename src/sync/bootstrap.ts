import { track } from '../analytics/track'
import { storage } from '../engine-api'
import { createSync, QuotaError } from './index'
import type { SyncEvent } from './types'

let started = false
let initialized = false
let live: ReturnType<typeof createSync> | null = null
const waiting = new Set<() => void>()
let probeDone: (ok: boolean | null) => void = () => {}
const probed = new Promise<boolean | null>(resolve => { probeDone = resolve })

export function syncProbe(): Promise<boolean | null> {
  return import.meta.env.VITE_SYNC_BASE ? probed : Promise.resolve(null)
}
export function syncNow(): Promise<void> {
  return started && live ? live.syncNow() : Promise.resolve()
}
export function syncConfigured(): boolean { return Boolean(import.meta.env.VITE_SYNC_BASE) }
export function syncStarted(): boolean { return started }
export function onSyncStart(cb: () => void): () => void {
  waiting.add(cb)
  return () => { waiting.delete(cb) }
}

/** 读取文档之前确认账户；离线/未登录只使用独立匿名库，旧库保留给明确文件导入。 */
export function startSyncIfConfigured(onEvent?: (e: SyncEvent) => void, onUnauthenticated?: () => void, enableSync = true): ReturnType<typeof createSync> | null {
  const baseUrl = import.meta.env.VITE_SYNC_BASE
  if (!baseUrl || initialized) return live
  initialized = true
  storage.setAccountScope(null)
  let initialId: string | null = null
  const resetIdentity = () => {
    live?.stop()
    started = false
    // 活着的旧文档保持旧命名空间；重新初始化先确认新账户，再恢复它的会话。
    location.reload()
  }
  const identity = async (): Promise<string | null> => {
    const response = await fetch(`${baseUrl}/identity`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
    if (response.status === 401 || response.status === 403) return null
    if (!response.ok) throw new Error(`GET /identity → ${response.status}`)
    const value = await response.json() as { userId?: unknown }
    if (typeof value.userId !== 'string' || !/^\d+$/.test(value.userId)) throw new Error('invalid stable account ID')
    return value.userId
  }
  void (async () => {
    try {
      initialId = await identity()
      if (initialId) {
        storage.setAccountScope(initialId)
        sessionStorage.removeItem('quadro.sync.gate-recheck')
        if (enableSync) live = createSync({ baseUrl, accountId: initialId, onIdentityChange: resetIdentity, onEvent: e => {
          if (e.type === 'error') console.warn('[sync]', e.error)
          if (e.type === 'quota') track('builder.sync.quota', { feature: e.feature, limit: e.limit })
          onEvent?.(e)
        } })
        started = Boolean(live)
        live?.start()
        waiting.forEach(cb => cb())
        waiting.clear()
        probeDone(true)
      } else {
        probeDone(false)
        const key = 'quadro.sync.gate-recheck'
        if (!sessionStorage.getItem(key) && onUnauthenticated) {
          sessionStorage.setItem(key, '1')
          onUnauthenticated()
        }
      }
    } catch (error) {
      console.warn('[sync] identity unavailable', error)
      probeDone(null)
      onEvent?.({ type: 'error', error })
    }
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return
      try { if (await identity() !== initialId) resetIdentity() }
      catch (error) { onEvent?.({ type: 'error', error }) }
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    window.addEventListener('pagehide', () => { live?.stop() })
    window.addEventListener('pageshow', event => { if (event.persisted) resetIdentity() })
  })()
  return live
}

export { QuotaError }
