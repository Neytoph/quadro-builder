// 「我的设计」里的「发布到广场」。
//
// 托管版构建时设了 VITE_PUBLISH_PAGE 和 VITE_PUBLISH_API 才有。Builder 只管三件事：
// 把这一座（连同画面和量）送上去、跳到托管站点的发布页、按后端说的状态标「已发布」。
// 确认、发布、更新都在发布页上做。开源本地版不设，没有这一块。
//
// 后端契约：
//
//	GET    {VITE_PUBLISH_API}           → {items: [{doc_id, url, stale, hidden}]}
//	                                      已经在广场上的那几座：url 是方案页地址，
//	                                      stale 是发布之后又改过，hidden 是被管理员下架了
//	DELETE {VITE_PUBLISH_API}/{doc_id}  → 200  从广场撤下这一座（之后可以重新发布）
import type { Lang } from './i18n'

const PAGES: Partial<Record<Lang, string>> = JSON.parse(import.meta.env.VITE_PUBLISH_PAGE || '{}')
const API = import.meta.env.VITE_PUBLISH_API || ''

export interface PublishState {
  doc_id: string
  url: string
  stale: boolean
  hidden: boolean
}

export function publishEnabled(): boolean {
  return Boolean(API) && Object.keys(PAGES).length > 0
}

/** 这一座的发布页地址，按界面语言去对应的那一页。 */
export function publishPage(lang: Lang, docId: string): string {
  const page = PAGES[lang]
  if (!page) throw new Error(`VITE_PUBLISH_PAGE 里没有 ${lang} 的发布页地址`)
  return `${page}?model=${encodeURIComponent(docId)}`
}

export async function publishStates(): Promise<Map<string, PublishState>> {
  const res = await fetch(API, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`publish states → ${res.status}`)
  const body = (await res.json()) as { items: PublishState[] }
  return new Map(body.items.map(s => [s.doc_id, s]))
}

export async function withdrawDoc(docId: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(docId)}`, {
    method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`withdraw → ${res.status}`)
}
