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

type Props = Record<string, string | number | boolean>
type Queued = { name: string; props?: Props }

let queue: Queued[] = []
let timer: ReturnType<typeof setTimeout> | null = null
// 高频动作（搭一步、挪一格、转一下）只累计次数，发的时候合成一条。
// 一条一条发的话，一次正经的搭建能刷出几百条记录，既淹掉别的动作，
// 也回答不了任何问题——真正想知道的是"这一程搭了多少步"。
const rolled = new Map<string, number>()

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
  for (const [name, n] of rolled) queue.push({ name, props: { n } })
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
  if (queue.length > 0) timer = setTimeout(() => flush(), BATCH_MS)
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

/** 立刻发，不等 4 秒的批量窗口。给崩溃这类"页面马上就没了"的场合用。 */
export function flushNow(): void {
  if (!URL_) return
  flush(true)
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
