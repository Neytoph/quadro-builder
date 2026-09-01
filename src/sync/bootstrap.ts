// 同步的启动开关。
//
// 只有构建时设了 VITE_SYNC_BASE 才启动——开源本地版不设，
// 这段就是个空转，行为与从前完全一致。

import { createSync, QuotaError } from './index'
import type { SyncEvent } from './types'

let started = false

export function startSyncIfConfigured(
  onEvent?: (e: SyncEvent) => void,
): ReturnType<typeof createSync> | null {
  const baseUrl = import.meta.env.VITE_SYNC_BASE
  if (!baseUrl || started) return null

  const sync = createSync({
    baseUrl,
    onEvent: (e) => {
      // 配额用尽要让用户看见，别静默失败
      if (e.type === 'quota') {
        console.warn(`[sync] 配额已满：${e.feature} ${e.used}/${e.limit}`)
      } else if (e.type === 'error') {
        console.warn('[sync] 同步出错', e.error)
      }
      onEvent?.(e)
    },
  })
  sync.start()
  started = true

  // 关页面前推一把，别把最后的改动留在本地
  window.addEventListener('pagehide', () => { void sync.syncNow() })

  return sync
}

export { QuotaError }
