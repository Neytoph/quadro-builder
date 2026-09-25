// 批量导入官方软件的 .qdf：每个文件存成一座造型（「我的设计」里的一份存档），
// 登录了就跟着 /models 同步进账号。官方文件里认不出的零件（布篷、滑梯的某些型号等）
// 按零件名和数量列出来，设计师自己决定要不要补；整个文件读不了的写明原因。

import { BuildModel, designName, docs, parseDesign } from '../engine-api'
import type { ModelJSON } from './ymodel'
import { partCountOf } from './ymodel'

/** 一次最多导入几个文件 */
export const MAX_IMPORT = 30

export interface ImportResult {
  file: string
  name: string
  ok: boolean
  docId: string | null
  /** 存下的造型，截缩略图用 */
  data: ModelJSON | null
  parts: number
  /** 认不出的零件：官方文件里的零件名和个数 */
  skipped: Array<{ name: string; count: number }>
  /** 读不了的原因：noParts 没认出零件，其余是解析时的报错 */
  error: string | null
}

export function isQdfFile(f: File) {
  return /\.qdf$/i.test(f.name)
}

type Parsed = ModelJSON & { stats?: { skipped?: Record<string, number> } }

/** 读一个 .qdf，存成一份存档。读不出零件的记为失败，不存。 */
export async function importOne(file: File): Promise<ImportResult> {
  const text = await file.text()
  const name = String(designName(file.name))
  const fail = (error: string, skipped: ImportResult['skipped'] = []): ImportResult =>
    ({ file: file.name, name, ok: false, docId: null, data: null, parts: 0, skipped, error })
  let data: Parsed | null
  // 用户拖进来的文件可能根本不是 .qdf：解析报错就是「读不了」，原因照原样给出去
  try {
    data = parseDesign(text) as Parsed | null
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  if (!data) return fail('noParts')
  const skipped = Object.entries(data.stats?.skipped || {})
    .map(([n, count]) => ({ name: n, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
  const model = new BuildModel()
  const res = model.loadJSON(data)
  if (!res.ok) return fail(String(res.reason), skipped)
  const json = model.toJSON() as ModelJSON
  if (!partCountOf(json)) return fail('noParts', skipped)
  const saved = await docs.saveDoc({ docId: null, name, data: json }) as { id: string }
  return { file: file.name, name, ok: true, docId: saved.id, data: json, parts: partCountOf(json), skipped, error: null }
}
