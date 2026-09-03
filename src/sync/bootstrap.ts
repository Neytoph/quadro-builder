// 同步的启动开关。
//
// 两道门，都得过：
//  1. 构建时设了 VITE_SYNC_BASE——开源本地版不设，这段就是空转，
//     行为与从前完全一致。
//  2. 后端认得出这个人——没登录就不启动。
//
// 第二道是后加的。原来只看第一道，结果没登录的访客每 30 秒发一次
// /models 拿 401，控制台一片红，请求也是白费。而且这类噪音会盖住
// 真正的错误。探测用的就是同一个拉取接口，不额外依赖任何平台专有的
// "我是谁"接口——任何实现了这套同步契约的后端，未登录时都会给 401/403。

import { track } from '../analytics/track'
import { createSync, QuotaError } from './index'
import type { SyncEvent } from './types'

let started = false

/** 后端认不认得出当前访客。401/403 = 没登录，其它错误当"暂时说不准"。 */
async function authenticated(baseUrl: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${baseUrl}/models?since=0`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) return false
    if (res.ok) return true
    return null // 5xx、429 之类：这次说不准，过会儿再问
  } catch {
    return null // 断网
  }
}

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
        // 撞配额是最该看见的一类事件：它直接对应"有人想用但被拦住了"
        track('builder.sync.quota', { feature: e.feature, limit: e.limit })
        console.warn(`[sync] 配额已满：${e.feature} ${e.used}/${e.limit}`)
      } else if (e.type === 'error') {
        track('builder.sync.error')
        console.warn('[sync] 同步出错', e.error)
      }
      onEvent?.(e)
    },
  })

  const begin = () => {
    if (started) return
    started = true
    track('builder.sync.start')
    sync.start()
    // 关页面前推一把，别把最后的改动留在本地
    window.addEventListener('pagehide', () => { void sync.syncNow() })
  }

  // 探一次再决定。没登录就先不启动，但留个钩子：用户可能在另一个标签页
  // 登录后切回来，那时候不该还要求他刷新页面。
  void (async () => {
    const ok = await authenticated(baseUrl)
    if (ok) { begin(); return }
    // 没登录也记一笔：进了 builder 却没登录的人有多少，
    // 直接说明入口那道闸门有没有漏。
    if (ok === false) track('builder.sync.anon')

    const recheck = async () => {
      if (started || document.visibilityState !== 'visible') return
      if (await authenticated(baseUrl)) {
        document.removeEventListener('visibilitychange', recheck)
        window.removeEventListener('focus', recheck)
        begin()
      }
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
  })()

  return sync
}

export { QuotaError }
