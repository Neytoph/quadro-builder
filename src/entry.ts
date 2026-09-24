// 打开 Builder 时地址上带的参数。别的页面（方案页、帖子、导出前的注册页）
// 靠它们让 Builder 一打开就做一件事：
//
//	?src=/path/to/file    取这份造型文件（Builder 的 JSON 或 .qdf）在新标签页里打开，只认同站路径
//	?src=plan:abc         不以 / 开头的是来源标记（pro: plan: invite: delivery:），记进 cookie qh_src
//	&name=小屋             标签页的名字
//	&copy=1               打开之后存一份到自己的存档里（登录了就跟着同步进账号）
//	?view=1               只看模式：嵌在方案页里，只有 3D 画面和分步手册，不改、不存
//	?export=manual|bom|bompng|shareimg|qdf|json   注册完回来，接着导出
//	?lang=zh|en|de        界面语言，嵌在别的页面里时跟着那一页
//
// 共享方案（托管版设了 VITE_SYNC_BASE 才认）：
//
//	?plan=<id>                     在标签页里打开共享方案，按自己的角色决定能不能编辑
//	&invite=<token>                成员邀请：登录后加入成为评论者
//	&compare=<版本 id>,<版本 id>    版本对照，版本 id 可以写 current
//	?delivery=<token>              交付页里嵌入的只读查看
//	?import=qdf                    打开后直接进入批量导入 .qdf
//	?room=brief:<id>               画房间边界，画完写回需求单
//
// 除了只看模式，参数读完就从地址栏去掉：刷新一下不该再打开一遍、再存一份。
// 当前标签页是共享方案时，地址栏由 CollabProvider 写成这个方案的地址。

export type ResumeExport = 'manual' | 'bom' | 'bompng' | 'shareimg' | 'qdf' | 'json'

const RESUMES: ResumeExport[] = ['manual', 'bom', 'bompng', 'shareimg', 'qdf', 'json']

export interface Entry {
  view: boolean
  src: string | null
  /** ?src= 里的来源标记 */
  source: string | null
  name: string | null
  copy: boolean
  resume: ResumeExport | null
  lang: 'zh' | 'en' | 'de' | null
  /** 带进来的 #s= 分享链接内容（只看模式里「在 Builder 里打开」要原样带过去） */
  hash: string
  plan: string | null
  invite: string | null
  compare: [string, string] | null
  delivery: string | null
  importQdf: boolean
  roomBrief: string | null
}

let entry: Entry | null = null

/** 同站路径才认：以 / 开头、不是 //（那是另一个站点）。 */
function sameSite(p: string | null): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//')) return null
  return p
}

const SOURCE_RE = /^(pro|plan|invite|delivery):[A-Za-z0-9_-]+$/

const collab = Boolean(import.meta.env.VITE_SYNC_BASE)

export function bootEntry(): Entry {
  if (entry) return entry
  const q = new URLSearchParams(location.search)
  const lang = q.get('lang')
  const resume = q.get('export') as ResumeExport | null
  const src = q.get('src')
  const cmp = (q.get('compare') || '').split(',').map(s => s.trim()).filter(Boolean)
  const room = q.get('room') || ''
  entry = {
    view: q.get('view') === '1',
    src: sameSite(src),
    source: src && SOURCE_RE.test(src) ? src : null,
    name: q.get('name'),
    copy: q.get('copy') === '1',
    resume: resume && RESUMES.includes(resume) ? resume : null,
    lang: lang === 'zh' || lang === 'en' || lang === 'de' ? lang : null,
    hash: location.hash,
    plan: collab ? q.get('plan') : null,
    invite: collab ? q.get('invite') : null,
    compare: collab && cmp.length === 2 ? [cmp[0], cmp[1]] : null,
    delivery: collab ? q.get('delivery') : null,
    importQdf: q.get('import') === 'qdf',
    roomBrief: collab && room.startsWith('brief:') ? room.slice('brief:'.length) : null,
  }
  if (!entry.view) {
    for (const k of ['src', 'name', 'copy', 'export', 'lang', 'import']) q.delete(k)
    const rest = q.toString()
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
  }
  return entry
}

/** 只看模式：嵌在方案页里的 3D 画面和分步手册。 */
export const VIEW_ONLY = bootEntry().view

/**
 * 只放一座、不读也不写这台设备上的标签页的打开方式：只看、交付查看、画房间。
 * 它们都不是这个人自己的标签页，不能盖掉。共享方案是标签页里的一个，照常读写。
 */
export const SESSIONLESS = VIEW_ONLY || !!bootEntry().delivery || !!bootEntry().roomBrief

/**
 * 来源标记记进 cookie qh_src，注册时网关写进用户的注册来源。规则和站点的 track.js
 * 一样：30 天，整站可读，已经有值就不覆盖。
 */
export function rememberSource() {
  const src = bootEntry().source
  if (!src || !collab) return
  if (document.cookie.split('; ').some(c => c.startsWith('qh_src='))) return
  document.cookie = `qh_src=${encodeURIComponent(src)}; Max-Age=${30 * 24 * 3600}; Path=/; SameSite=Lax`
}

/** 只看模式里「在 Builder 里打开」去的地址：同一份造型，完整的 Builder。 */
export function fullBuilderUrl(): string {
  const e = bootEntry()
  const base = `${location.pathname}`
  if (e.src) {
    const q = new URLSearchParams({ src: e.src })
    if (e.name) q.set('name', e.name)
    return `${base}?${q.toString()}`
  }
  return `${base}${e.hash}`
}

/** 地址栏去掉一个参数（邀请加入以后、对照退出以后）。 */
export function dropParam(key: string) {
  const q = new URLSearchParams(location.search)
  q.delete(key)
  const rest = q.toString()
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
}
