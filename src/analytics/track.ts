// 行为打点。
//
// 和 sync 一样是"平台侧"的东西，所以放在 engine 之外：engine 里的代码
// 来自 thecodingdad/quadro-3D，不往里面塞任何平台专有的逻辑。
//
// 三条规矩，和后端那边是一套（gateway/internal/events）：
//
//  1. 没配 VITE_ANALYTICS_URL 就完全空转。开源本地版不配，
//     一个字节都不会往外发——这和 sync 的处理方式一致。
//  2. 只记"做了什么"，不记"是谁在哪"：没有 IP、没有 UA 原文、
//     没有任何用户输入。props 里只放枚举和数字。
//     理由很实际：这库要能随手打开看。
//  3. 打点绝不能反过来伤到产品。所有出口都包在 try 里，
//     失败就算了，不重试、不报错、不弹提示。
//
// 会话串存在 sessionStorage，关掉标签页就换一个，跨设备串不起来。

const URL_ = import.meta.env.VITE_ANALYTICS_URL as string | undefined
const SESSION_KEY = 'quadro.analytics.session'
const BATCH_MS = 4000
const MAX_BATCH = 20

type Props = Record<string, string | number | boolean>
type Queued = { name: string; props?: Props }

let queue: Queued[] = []
let timer: ReturnType<typeof setTimeout> | null = null
// 高频动作（搭一步、挪一格、转一下）只累计次数，发的时候合成一条。
// 一条一条发的话，一次正经的搭建能刷出几百条记录，既淹掉别的动作，
// 也回答不了任何问题——真正想知道的是"这一程搭了多少步"。
const rolled = new Map<string, number>()

function session(): string {
  try {
    let s = sessionStorage.getItem(SESSION_KEY)
    if (!s) {
      s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      sessionStorage.setItem(SESSION_KEY, s)
    }
    return s
  } catch {
    return '' // 隐私模式下存不了，那就每批各算一个会话
  }
}

function drainRolled(): void {
  for (const [name, n] of rolled) queue.push({ name, props: { n } })
  rolled.clear()
}

function flush(beacon = false): void {
  if (!URL_) return
  drainRolled()
  if (queue.length === 0) return
  const body = JSON.stringify({ session: session(), events: queue.splice(0, MAX_BATCH) })
  if (timer) { clearTimeout(timer); timer = null }
  try {
    // 页面要走的时候必须用 sendBeacon：fetch 的请求会在卸载那一下
    // 被浏览器掐掉，而"用完就走"恰恰是最该记下来的一批。
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(URL_, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(URL_, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
  } catch { /* 见规矩 3 */ }
}

/** 记一个动作。名字要分层：`builder.对象.动作`。 */
export function track(name: string, props?: Props): void {
  if (!URL_) return
  queue.push(props ? { name, props } : { name })
  if (queue.length >= MAX_BATCH) { flush(); return }
  if (!timer) timer = setTimeout(() => flush(), BATCH_MS)
}

/** 高频动作只累计次数，到点合成一条 `{n: 次数}` 发出去。 */
export function bumpCount(name: string): void {
  if (!URL_) return
  rolled.set(name, (rolled.get(name) || 0) + 1)
  if (!timer) timer = setTimeout(() => flush(), BATCH_MS)
}

/** 挂在页面生命周期上。App 挂载时调一次就够。 */
export function startAnalytics(): void {
  if (!URL_) return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
  // pagehide 比 unload 可靠：手机上从 Safari 切走走的是这条。
  window.addEventListener('pagehide', () => flush(true))
}
