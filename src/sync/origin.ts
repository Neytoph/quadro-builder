// 这一座是从哪个方案打开的。
//
// 从方案页、帖子里的造型进 Builder（?src= 或 ?origin=）打开的那个标签页，记下打开时用的
// 站内地址；这个标签页存进存档时，把地址挂在那份存档上；同步第一次把它推上服务器时一起带上
// （PUT /models 的 origin），托管版据此给方案的作者记一次「照着搭」。推上去之后就忘掉。
//
// 标签页那一段放在内存里：关掉页面再打开，那就是另一回事了。存档那一段放在 localStorage：
// 存下以后没登录、隔天登录了才推上去，也还带得上。开源本地版不同步，这里记下的东西没人读。

const KEY = 'quadro.docOrigin.v1'

const byTab = new Map<string, string>()

function readAll(): Record<string, string> {
  return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>
}

function writeAll(all: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(all))
}

/** 这个标签页是从 origin 打开的。 */
export function tabOpenedFrom(tabId: string, origin: string) {
  byTab.set(tabId, origin)
}

/** 标签页存成了 docId 这份存档：它是从方案打开的，就把出处挂到存档上（已经挂过的不改）。 */
export function tabSavedAs(tabId: string, docId: string) {
  const origin = byTab.get(tabId)
  if (!origin) return
  const all = readAll()
  if (all[docId]) return
  all[docId] = origin
  writeAll(all)
}

/** 这份存档的出处，推给服务器时带上。 */
export function originOf(docId: string): string | undefined {
  return readAll()[docId]
}

/** 推上去了，忘掉。 */
export function forgetOrigin(docId: string) {
  const all = readAll()
  if (!(docId in all)) return
  delete all[docId]
  writeAll(all)
}
