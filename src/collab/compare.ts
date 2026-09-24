// 版本对照：两份造型按零件 id 比较（同一个方案里零件 id 一直不变），
// 料表按行比较数量。

import { BuildModel, computeBOM } from '../engine-api'
import { flatten, sameJson, type ModelJSON } from './ymodel'

export interface ModelDiff {
  /** 右边有、左边没有 */
  added: Set<string>
  /** 左边有、右边没有 */
  removed: Set<string>
  /** 两边都有、字段不一样（挪了位置、换了颜色） */
  changed: Set<string>
}

export function diffModels(left: ModelJSON, right: ModelJSON): ModelDiff {
  const a = flatten(left)
  const b = flatten(right)
  const out: ModelDiff = { added: new Set(), removed: new Set(), changed: new Set() }
  for (const [id, rec] of b) {
    const prev = a.get(id)
    if (!prev) out.added.add(id)
    else if (!sameJson(prev, rec)) out.changed.add(id)
  }
  for (const id of a.keys()) if (!b.has(id)) out.removed.add(id)
  return out
}

export interface BomDiffRow {
  key: string
  group: string
  name: string
  color: string | null
  left: number
  right: number
}

const GROUPS = ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'reinforcements', 'screws'] as const

type Row = Record<string, unknown>

function bomRows(json: ModelJSON): Map<string, { group: string; name: string; color: string | null; count: number }> {
  const model = new BuildModel()
  const res = model.loadJSON(json)
  if (!res.ok) throw new Error(`compare: model does not load (${res.reason})`)
  const bom = computeBOM(model) as unknown as Record<string, Row[]>
  const out = new Map<string, { group: string; name: string; color: string | null; count: number }>()
  for (const g of GROUPS) {
    for (const r of bom[g] || []) {
      const id = String(r.tubeId ?? r.panelId ?? r.type ?? r.id ?? r.kind ?? r.key ?? '')
      const color = r.color ? String(r.color) : null
      const key = `${g}:${id}|${color || ''}|${r.w ?? ''}x${r.h ?? ''}`
      const prev = out.get(key)
      const count = Number(r.count) || 0
      if (prev) prev.count += count
      else out.set(key, { group: g, name: String(r.name || id), color: r.colorName ? String(r.colorName) : color, count })
    }
  }
  return out
}

/** 料表里数量不一样的行（一边没有的算 0）。 */
export function diffBom(left: ModelJSON, right: ModelJSON): BomDiffRow[] {
  const a = bomRows(left)
  const b = bomRows(right)
  const out: BomDiffRow[] = []
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const l = a.get(key)
    const r = b.get(key)
    const left = l?.count || 0
    const right = r?.count || 0
    if (left === right) continue
    const row = (r || l)!
    out.push({ key, group: row.group, name: row.name, color: row.color, left, right })
  }
  return out.sort((x, y) => GROUPS.indexOf(x.group as typeof GROUPS[number]) - GROUPS.indexOf(y.group as typeof GROUPS[number]) || x.name.localeCompare(y.name))
}
