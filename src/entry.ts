// 打开 Builder 时地址上带的参数。别的页面（方案页、帖子、导出前的注册页）
// 靠它们让 Builder 一打开就做一件事：
//
//	?src=/path/to/file    取这份造型文件（Builder 的 JSON 或 .qdf）在新标签页里打开，只认同站路径
//	&name=小屋             标签页的名字
//	&copy=1               打开之后存一份到自己的存档里（登录了就跟着同步进账号）
//	?view=1               只看模式：嵌在方案页里，只有 3D 画面和分步手册，不改、不存
//	?export=manual|bom|bompng|shareimg|qdf|json   注册完回来，接着导出
//	?lang=zh|en|de        界面语言，嵌在别的页面里时跟着那一页
//
// 除了只看模式，这些参数读完就从地址栏去掉：刷新一下不该再打开一遍、再存一份。

export type ResumeExport = 'manual' | 'bom' | 'bompng' | 'shareimg' | 'qdf' | 'json'

const RESUMES: ResumeExport[] = ['manual', 'bom', 'bompng', 'shareimg', 'qdf', 'json']

export interface Entry {
  view: boolean
  src: string | null
  name: string | null
  copy: boolean
  resume: ResumeExport | null
  lang: 'zh' | 'en' | 'de' | null
  /** 带进来的 #s= 分享链接内容（只看模式里「在 Builder 里打开」要原样带过去） */
  hash: string
}

let entry: Entry | null = null

/** 同站路径才认：以 / 开头、不是 //（那是另一个站点）。 */
function sameSite(p: string | null): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//')) return null
  return p
}

export function bootEntry(): Entry {
  if (entry) return entry
  const q = new URLSearchParams(location.search)
  const lang = q.get('lang')
  const resume = q.get('export') as ResumeExport | null
  entry = {
    view: q.get('view') === '1',
    src: sameSite(q.get('src')),
    name: q.get('name'),
    copy: q.get('copy') === '1',
    resume: resume && RESUMES.includes(resume) ? resume : null,
    lang: lang === 'zh' || lang === 'en' || lang === 'de' ? lang : null,
    hash: location.hash,
  }
  if (!entry.view) {
    for (const k of ['src', 'name', 'copy', 'export', 'lang']) q.delete(k)
    const rest = q.toString()
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)
  }
  return entry
}

/** 只看模式：嵌在方案页里的 3D 画面和分步手册。 */
export const VIEW_ONLY = bootEntry().view

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
