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
// 已经在跑的那一个。应用要「这就推上去」时找它。
let live: ReturnType<typeof createSync> | null = null
// 等着同步跑起来的界面（「发到社区」只给后端认得出的人）
const waiting = new Set<() => void>()

/**
 * 立刻跑一轮同步，等它跑完。
 *
 * 存下来的造型先落在这台机器的 IndexedDB 里，要等下一个同步周期才上服务器。
 * 中间这段时间，别处（比如社区发帖页，它只认服务器那张列表）看不见这一座。
 * 所以存完、发出去之前，都在这里等一等。
 *
 * 没接同步的部署（开源本地版）和还没登录的时候是空转：本来就没有服务器。
 */
export function syncNow(): Promise<void> {
  return started && live ? live.syncNow() : Promise.resolve()
}

/** 部署有没有接同步。开源本地版没有云端，也就谈不上「只在这台设备上」。 */
export function syncConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SYNC_BASE)
}

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

/** 一次会话里只让 onUnauthenticated 触发一次，防止没有闸门的部署反复重载。 */
const GATE_KEY = 'quadro.sync.gate-recheck'

export function startSyncIfConfigured(
  onEvent?: (e: SyncEvent) => void,
  /**
   * 后端明确说"你没登录"时调一次（网络不通不算，那是说不准）。
   *
   * 为什么需要它：应用壳可能是 Service Worker 从预缓存里给的，导航请求
   * 压根没走网络，入口那道闸门（服务端重定向）也就没机会生效——登录过一次
   * 之后，退了登录照样能把工具打开。SW 是缓存不是授权层，所以由应用自己
   * 在启动时确认一次会话。
   *
   * 具体怎么处置留给调用方：这一层不该认识 /login 这种平台专有的地址。
   */
  onUnauthenticated?: () => void,
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
    live = sync
    track('builder.sync.start')
    sync.start()
    waiting.forEach((cb) => cb())
    waiting.clear()
    // 关页面前推一把，别把最后的改动留在本地
    window.addEventListener('pagehide', () => { void sync.syncNow() })
  }

  // 探一次再决定。没登录就先不启动，但留个钩子：用户可能在另一个标签页
  // 登录后切回来，那时候不该还要求他刷新页面。
  void (async () => {
    const ok = await authenticated(baseUrl)
    if (ok) {
      try { sessionStorage.removeItem(GATE_KEY) } catch { /* 隐私模式 */ }
      begin()
      return
    }
    // 没登录也记一笔：进了 builder 却没登录的人有多少，
    // 直接说明入口那道闸门有没有漏。
    if (ok === false) {
      track('builder.sync.anon')
      let first = true
      try {
        first = !sessionStorage.getItem(GATE_KEY)
        if (first) sessionStorage.setItem(GATE_KEY, '1')
      } catch { /* 隐私模式：存不了就当第一次，最多多走一次 */ }
      // 只处置一次。没有入口闸门的部署（自建、开源本地版接了同步）
      // 重载之后仍然是未登录，再触发就成了死循环。
      if (first && onUnauthenticated) {
        onUnauthenticated()
        return
      }
    }

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

/** 同步跑起来了没有，也就是后端认不认得出这个人。 */
export function syncStarted(): boolean {
  return started
}

/** 同步跑起来的时候叫一声（在另一个标签页登录后切回来，也会在这时候跑起来）。返回的函数用来退订。 */
export function onSyncStart(cb: () => void): () => void {
  waiting.add(cb)
  return () => { waiting.delete(cb) }
}

export { QuotaError }
