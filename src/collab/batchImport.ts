// 批量导入官方软件的 .qdf：每个文件存成一座造型（「我的设计」里的一份存档），
// 登录了就跟着 /models 同步进账号。官方文件里认不出的零件（布篷、滑梯的某些型号等）
// 按零件名和数量列出来，设计师自己决定要不要补。

import { BuildModel, designName, docs, parseDesign } from '../engine-api'
import type { ModelJSON } from './ymodel'
import { partCountOf } from './ymodel'

export interface ImportResult {
  file: string
  name: string
  ok: boolean
  docId: string | null
  parts: number
  /** 认不出的零件：官方文件里的零件名和个数 */
  skipped: Array<{ name: string; count: number }>
  error: string | null
}

export function isQdfFile(f: File) {
  return /\.qdf$/i.test(f.name)
}

/** 读一个 .qdf，存成一份存档。解析不出零件的记为失败，不存。 */
export async function importOne(file: File): Promise<ImportResult> {
  const text = await file.text()
  const name = String(designName(file.name))
  const data = parseDesign(text) as (ModelJSON & { stats?: { skipped?: Record<string, number> } }) | null
  if (!data) return { file: file.name, name, ok: false, docId: null, parts: 0, skipped: [], error: 'noParts' }
  const skipped = Object.entries(data.stats?.skipped || {})
    .map(([n, count]) => ({ name: n, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
  const model = new BuildModel()
  const res = model.loadJSON(data)
  if (!res.ok) return { file: file.name, name, ok: false, docId: null, parts: 0, skipped, error: String(res.reason) }
  const json = model.toJSON() as ModelJSON
  if (!partCountOf(json)) return { file: file.name, name, ok: false, docId: null, parts: 0, skipped, error: 'noParts' }
  const saved = await docs.saveDoc({ docId: null, name, data: json }) as { id: string }
  return { file: file.name, name, ok: true, docId: saved.id, parts: partCountOf(json), skipped, error: null }
}
