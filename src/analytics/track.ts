// 行为打点。
//
// 和 sync 一样是"平台侧"的东西，所以放在 engine 之外：engine 里的代码
// 来自 thecodingdad/quadro-3D，不往里面塞任何平台专有的逻辑。
//
// 三条规矩，和后端那边是一套（gateway/internal/events）：
//
//  1. 没配 VITE_ANALYTICS_URL 就不记录统计。开源本地版不配，
//     一个字节都不会往外发——这和 sync 的处理方式一致。
//     成功动作仍可通过本地窗口事件通知托管页面，只传动作名称。
//  2. 只记"做了什么"，不记"是谁在哪"：没有 IP、没有 UA 原文、
//     没有任何用户输入。props 里只放枚举和数字。
//     理由很实际：这库要能随手打开看。
//  3. 打点绝不能反过来伤到产品。所有出口都包在 try 里，
//     失败就算了，不重试、不报错、不弹提示。
//
// 两个标识，回答的是两个不同的问题：
//
//   session  存 sessionStorage，关掉标签页就换一个。回答"这一程做了什么"。
//            注册成功时服务端只按它回填 user_id——只认领这一程，
//            因为同一台设备可能是一家人在用，全量认领会把别人的行为记到你头上。
//   device   存 localStorage，长期不变。回答"这人来过几次"。
//            不做回填，查询时 join，原始数据留着，判断错了还能改。
//
// 两个都是本地生成的随机串，跟 IP 无关：IP 在 CGNAT 下既会把一个小区
// 并成一个人，又会因为切网把一个人拆成好几个，两头都错。

const URL_ = import.meta.env.VITE_ANALYTICS_URL as string | undefined
// 和站点的打点（小麦坊 deploy/site/app/track.js）用同一对键：设计器和站点在
// 同一个域名下，同一个浏览器只算一个人，后台才连得上「从哪条链接进站 →
// 打开设计器 → 搭完一座」。OLD_* 是这边以前单独用的键，老访客第一次来时
// 把它的值接过来，这台设备在设计器里的历史还连得上。
const SESSION_KEY = 'qh_sess'
const DEVICE_KEY = 'qh_device'
const OLD_SESSION_KEY = 'quadro.analytics.session'
const OLD_DEVICE_KEY = 'quadro.analytics.device'
// 链接上的来源标记（?from=xhs-0922），规则和站点那份一致：只存第一次进站的那个，
// 注册时登录页把它随表单交上去。
const FROM_KEY = 'qh_from'
const FROM_RE = /[?&]from=([A-Za-z0-9_-]{1,32})(?:[&#]|$)/
const BATCH_MS = 4000
const MAX_BATCH = 20
const TIME_TICK_MS = 5000
const TIME_REPORT_MS = 15000
const ACTIVE_WINDOW_MS = 30000
// 托管页面可订阅成功动作、提交有限的入口统计；不传模型或用户输入。
const SITE_ACTIONS = new Set(['builder.design.save', 'builder.design.saveAs', 'builder.export.manual.done'])
const SITE_TRACK_NAMES = new Set(['builder.wechat.open', 'builder.wechat.download', 'builder.wechat.prompt'])
const SITE_TRACK_SOURCES = new Set(['home', 'chat', 'builder-help', 'builder-save', 'builder-manual'])

type Props = Record<string, string | number | boolean>
type Queued = { name: string; props?: Props }

let queue: Queued[] = []
let timer: ReturnType<typeof setTimeout> | null = null
// 高频动作（搭一步、挪一格、转一下）只累计次数，发的时候合成一条。
// 一条一条发的话，一次正经的搭建能刷出几百条记录，既淹掉别的动作，
// 也回答不了任何问题——真正想知道的是"这一程搭了多少步"。
const rolled = new Map<string, number>()
// 每次加载页面换一个标识。同一标签页内重新打开设计器也能分成两次访问。
const visit = rid()
let started = false

type SiteClock = { timeVersion?: number; embeddedInput?: (event: Event, source: Window) => void }

function parentClock(): SiteClock | undefined {
  try {
    if (window.parent === window || window.parent.location.origin !== window.location.origin) return
    const clock = (window.parent as Window & { QHTrack?: SiteClock }).QHTrack
    if (clock?.timeVersion === 1 && typeof clock.embeddedInput === 'function') return clock
  } catch { /* 跨域嵌入由 Builder 自己计时 */ }
}

function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function stored(store: Storage | undefined, key: string, oldKey: string): string {
  try {
    if (!store) return ''
    let v = store.getItem(key)
    if (!v) {
      v = store.getItem(oldKey) || rid()
      store.setItem(key, v)
    }
    return v
  } catch {
    return '' // 无痕模式下存不了。这是用户的选择，不去绕过它。
  }
}

function session(): string {
  return stored(typeof sessionStorage === 'undefined' ? undefined : sessionStorage, SESSION_KEY, OLD_SESSION_KEY)
}

function device(): string {
  return stored(typeof localStorage === 'undefined' ? undefined : localStorage, DEVICE_KEY, OLD_DEVICE_KEY)
}

/**
 * 这一次打开带的来源标记，没带就是空串。带了的话顺手记成这台设备第一次进站的
 * 来源（已经有了就不动）。没配 VITE_ANALYTICS_URL 时什么都不记。
 */
export function landedFrom(): string {
  if (!URL_ || typeof location === 'undefined') return ''
  const m = FROM_RE.exec(location.search)
  if (!m) return ''
  const from = m[1].toLowerCase()
  try {
    if (!localStorage.getItem(FROM_KEY)) localStorage.setItem(FROM_KEY, from)
  } catch { /* 无痕模式存不了，那就只记这一次打开 */ }
  return from
}

function drainRolled(): void {
  for (const [name, n] of rolled) queue.push({ name, props: { n, visit } })
  rolled.clear()
}

function flush(beacon = false): void {
  if (!URL_) return
  drainRolled()
  if (queue.length === 0) return
  const body = JSON.stringify({ session: session(), device: device(), events: queue.splice(0, MAX_BATCH) })
  if (timer) { clearTimeout(timer); timer = null }
  // 一次只发 MAX_BATCH 条，超出的留在队列里。不在这儿重排定时器的话，
  // 剩下的要等下一次 track 或者 pagehide 才走。
  if (queue.length > 0 && !beacon) timer = setTimeout(() => flush(), BATCH_MS)
  try {
    // 页面要走的时候必须用 sendBeacon：fetch 的请求会在卸载那一下
    // 被浏览器掐掉，而"用完就走"恰恰是最该记下来的一批。
    if (beacon && navigator.sendBeacon) {
      if (navigator.sendBeacon(URL_, new Blob([body], { type: 'application/json' }))) {
        if (queue.length > 0) flush(true)
        return
      }
    }
    void fetch(URL_, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
  } catch { /* 见规矩 3 */ }
  if (beacon && queue.length > 0) flush(true)
}

/** 记一个动作。名字要分层：`builder.对象.动作`。 */
export function track(name: string, props?: Props): void {
  if (SITE_ACTIONS.has(name) && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('quadro-builder:action', { detail: { name } }))
    } catch { /* 托管页面通知不影响原动作和统计 */ }
  }
  if (!URL_) return
  queue.push({ name, props: { ...props, visit,
    ...(name === 'builder.app.open' ? { time_v: 1, time_owner: parentClock() ? 'site' : 'builder' } : {}),
  } })
  if (queue.length >= MAX_BATCH) { flush(); return }
  if (!timer) timer = setTimeout(() => flush(), BATCH_MS)
}

/** 高频动作只累计次数，到点合成一条 `{n: 次数}` 发出去。 */
export function bumpCount(name: string): void {
  if (!URL_) return
  rolled.set(name, (rolled.get(name) || 0) + 1)
  if (!timer) timer = setTimeout(() => flush(), BATCH_MS)
}

/** 立刻发，不等 4 秒的批量窗口。给崩溃这类"页面马上就没了"的场合用。 */
export function flushNow(): void {
  if (!URL_) return
  flush(true)
}

function trackSiteEvent(event: Event): void {
  const detail: unknown = (event as CustomEvent<unknown>).detail
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return
  const { name, props } = detail as { name?: unknown; props?: unknown }
  if (typeof name !== 'string' || !SITE_TRACK_NAMES.has(name)) return
  if (!props || typeof props !== 'object' || Array.isArray(props)) return
  const source = (props as { source?: unknown }).source
  if (typeof source !== 'string' || !SITE_TRACK_SOURCES.has(source)) return
  track(name, { source })
}

/** 挂在页面生命周期上。App 挂载时调一次就够。 */
export function startAnalytics(): void {
  if (started) return
  started = true
  // 同一个监听函数重复注册也只运行一次；入站名称不在成功动作里，不会循环。
  window.addEventListener('quadro-builder:track', trackSiteEvent)
  if (!URL_) return
  const timingDocument = document as Document & { readonly prerendering?: boolean }
  const owner = parentClock()
  if (owner) {
    for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
      window.addEventListener(name, event => {
        if (event.isTrusted) owner.embeddedInput?.(event, window)
      }, { passive: true })
    }
    window.addEventListener('pagehide', () => flush(true))
    return
  }
  let lastTick = performance.now()
  let lastInput = -Infinity
  let wasVisible = !timingDocument.prerendering && document.visibilityState === 'visible'
  let visibleMs = 0
  let activeMs = 0
  let reportedVisibleSec = 0
  let reportedActiveSec = 0
  let lastReport = lastTick

  const tick = () => {
    if (timingDocument.prerendering) return
    const now = performance.now()
    // 休眠或浏览器节流后不把整段间隔算成前台时长。
    const elapsed = Math.max(0, Math.min(now - lastTick, TIME_TICK_MS * 2))
    if (wasVisible) {
      visibleMs += elapsed
      activeMs += Math.min(elapsed, Math.max(0, lastInput + ACTIVE_WINDOW_MS - (now - elapsed)))
    }
    lastTick = now
  }
  const report = (beacon = false) => {
    if (timingDocument.prerendering) return
    tick()
    const visibleSec = Math.floor(visibleMs / 1000)
    const activeSec = Math.floor(activeMs / 1000)
    const visible = visibleSec - reportedVisibleSec
    const active = Math.min(visible, activeSec - reportedActiveSec)
    if (visible > 0 || active > 0) {
      track('builder.app.time', { visible, active })
      reportedVisibleSec = visibleSec
      reportedActiveSec += active
    }
    lastReport = performance.now()
    if (beacon) flush(true)
  }
  const input = (event: Event) => {
    if (!event.isTrusted || !wasVisible || timingDocument.prerendering) return
    tick()
    lastInput = performance.now()
  }
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(name, input, { passive: true })
  }
  window.setInterval(() => {
    tick()
    if (performance.now() - lastReport >= TIME_REPORT_MS) { report(); flush() }
  }, TIME_TICK_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      report(true)
      wasVisible = false
      lastInput = -Infinity
    } else {
      lastTick = performance.now()
      wasVisible = !timingDocument.prerendering
    }
  })
  // pagehide 比 unload 可靠：手机上从 Safari 切走走的是这条。
  document.addEventListener('prerenderingchange', () => {
    lastTick = performance.now(); lastReport = lastTick
    wasVisible = document.visibilityState === 'visible'
  }, { once: true })
  window.addEventListener('pagehide', () => { report(true); wasVisible = false; lastInput = -Infinity })
  window.addEventListener('pageshow', () => { lastTick = performance.now(); wasVisible = !timingDocument.prerendering && document.visibilityState === 'visible' })
}
