// 造型的 Yjs 文档。
//
// 结构：根下两个 Y.Map。
//   parts  partId -> Y.Map，字段和 model.toJSON() 里这一件的对象一致，另加 `$type`
//          说明它属于哪一类（node / tube / panel / clamp / textile / fitting / slide / group）
//   meta   format（造型格式版本）、name（共享方案的名字）、room（房间边界）
//
// 每个字段单独一个键：两个人改同一件的不同字段能合并，改同一个字段按 Yjs 的规则留一个。
// 字段的值是普通 JSON（数组、对象整体替换）。
//
// 引擎的 BuildModel 仍是画面和编辑算法用的内存结构。它和 Yjs 文档之间只有两条路：
//   编辑提交：一次编辑前后的两份 JSON 算出差异，按零件写进文档（applyDelta）
//   文档变化：从文档导出整份 JSON（docToJSON），交给 model.loadJSON

import * as Y from 'yjs'
import { FORMAT_VERSION } from '../engine/config.js'

type Json = unknown
export type Rec = Record<string, Json>
export type ModelJSON = Record<string, Json> & { format?: number; nodes: Rec[] }

/** model.toJSON() 里的各个零件数组，和它们在 parts 里的 `$type`。 */
export const COLLECTIONS = [
  ['nodes', 'node'],
  ['tubes', 'tube'],
  ['panels', 'panel'],
  ['clamps', 'clamp'],
  ['textiles', 'textile'],
  ['fittings', 'fitting'],
  ['slides', 'slide'],
  ['groups', 'group'],
] as const

export type PartType = typeof COLLECTIONS[number][1]
const COLLECTION_OF = new Map<string, string>(COLLECTIONS.map(([c, ty]) => [ty, c]))
const TYPE_KEY = '$type'

export function partsMap(doc: Y.Doc): Y.Map<Y.Map<Json>> {
  return doc.getMap('parts')
}

export function metaMap(doc: Y.Doc): Y.Map<Json> {
  return doc.getMap('meta')
}

/** 文档里有没有造型：一件零件都没有、也没写过格式版本的，是还没生成的新文档。 */
export function docIsEmpty(doc: Y.Doc): boolean {
  return partsMap(doc).size === 0 && !metaMap(doc).has('format')
}

function seqOf(id: string): number {
  const m = /(\d+)$/.exec(id)
  return m ? parseInt(m[1], 10) : 0
}

/** JSON 值相等，对象不看键的顺序。 */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as Json[]
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]))
  }
  const ka = Object.keys(a as Rec)
  const kb = Object.keys(b as Rec)
  return ka.length === kb.length && ka.every(k => k in (b as Rec) && sameJson((a as Rec)[k], (b as Rec)[k]))
}

/** 造型 JSON 摊成 partId -> 带 `$type` 的记录。id 重复就地报错：两件零件不能共用一条记录。 */
export function flatten(json: ModelJSON): Map<string, Rec> {
  const out = new Map<string, Rec>()
  for (const [coll, type] of COLLECTIONS) {
    const list = json[coll]
    if (list == null) continue
    if (!Array.isArray(list)) throw new Error(`model JSON: ${coll} is not an array`)
    for (const raw of list as Rec[]) {
      const id = raw.id
      if (typeof id !== 'string' || !id) throw new Error(`model JSON: ${type} without id`)
      if (out.has(id)) throw new Error(`model JSON: duplicate part id ${id}`)
      out.set(id, { ...raw, [TYPE_KEY]: type })
    }
  }
  return out
}

/** 一件零件写进 parts：只写和 prev 不一样的字段，删掉 next 里没有的字段。 */
function writePart(parts: Y.Map<Y.Map<Json>>, id: string, next: Rec, prev: Rec | null) {
  let ymap = parts.get(id)
  if (!ymap || ymap.get(TYPE_KEY) !== next[TYPE_KEY]) {
    ymap = new Y.Map<Json>()
    for (const [k, v] of Object.entries(next)) ymap.set(k, v)
    parts.set(id, ymap)
    return
  }
  for (const [k, v] of Object.entries(next)) {
    if (prev && k in prev && sameJson(prev[k], v) && ymap.has(k)) continue
    if (!prev && sameJson(ymap.get(k), v)) continue
    ymap.set(k, v)
  }
  const from = prev || Object.fromEntries(ymap.entries())
  for (const k of Object.keys(from)) {
    if (!(k in next) && ymap.has(k)) ymap.delete(k)
  }
}

/**
 * 一次编辑的前后两份 JSON，把变了的零件和字段写进文档。只碰这次编辑改动过的东西：
 * 编辑期间别人对其他零件、其他字段的修改原样留着。
 */
export function applyDelta(doc: Y.Doc, before: ModelJSON, after: ModelJSON, origin: unknown) {
  const a = flatten(before)
  const b = flatten(after)
  const parts = partsMap(doc)
  doc.transact(() => {
    for (const [id, rec] of b) {
      const prev = a.get(id) || null
      if (prev && prev[TYPE_KEY] === rec[TYPE_KEY] && sameJson(prev, rec) && parts.has(id)) continue
      writePart(parts, id, rec, prev && prev[TYPE_KEY] === rec[TYPE_KEY] ? prev : null)
    }
    for (const id of a.keys()) {
      if (!b.has(id) && parts.has(id)) parts.delete(id)
    }
    const meta = metaMap(doc)
    const format = after.format ?? FORMAT_VERSION
    if (meta.get('format') !== format) meta.set('format', format)
  }, origin)
  return summarize(a, b)
}

/** 一次修改的大概：加了几件、删了几件、挪了几件、改了几件（颜色之类）。 */
export interface EditSummary {
  added: number
  removed: number
  moved: number
  changed: number
}

// 这些字段变了算「挪了」：位置、朝向、挂在哪
const PLACE_KEYS = new Set(['x', 'y', 'z', 'a', 'b', 't0', 'len', 'quat', 'geom', 'dir', 'off', 'hook', 'foot', 'bowCenter', 'clampOn', 'bearingOn', 'tube'])

export function summarize(a: Map<string, Rec>, b: Map<string, Rec>): EditSummary {
  const out: EditSummary = { added: 0, removed: 0, moved: 0, changed: 0 }
  for (const [id, rec] of b) {
    const prev = a.get(id)
    if (!prev) { out.added++; continue }
    if (sameJson(prev, rec)) continue
    const keys = new Set([...Object.keys(prev), ...Object.keys(rec)])
    let moved = false
    for (const k of keys) if (!sameJson(prev[k], rec[k]) && PLACE_KEYS.has(k)) moved = true
    if (moved) out.moved++
    else out.changed++
  }
  for (const id of a.keys()) if (!b.has(id)) out.removed++
  return out
}

/** 把几件零件（带 `$type` 的记录）按原样写回文档。 */
export function restoreParts(doc: Y.Doc, recs: Map<string, Rec>, origin: unknown) {
  const parts = partsMap(doc)
  doc.transact(() => {
    for (const [id, rec] of recs) writePart(parts, id, rec, null)
  }, origin)
}

/** 文档改成和 json 完全一样：和文档现有内容逐件比较，多的删掉，缺的、不一样的写上。 */
export function writeJSON(doc: Y.Doc, json: ModelJSON, origin: unknown) {
  const b = flatten(json)
  const parts = partsMap(doc)
  doc.transact(() => {
    for (const id of [...parts.keys()]) {
      if (!b.has(id)) parts.delete(id)
    }
    for (const [id, rec] of b) writePart(parts, id, rec, null)
    const meta = metaMap(doc)
    const format = json.format ?? FORMAT_VERSION
    if (meta.get('format') !== format) meta.set('format', format)
  }, origin)
}

/** 新文档：写进一份造型 JSON。 */
export function docFromJSON(json: ModelJSON, opts?: { gc?: boolean }): Y.Doc {
  const doc = new Y.Doc({ gc: opts?.gc ?? true })
  writeJSON(doc, json, null)
  return doc
}

/**
 * 从文档导出造型 JSON，形状和 model.toJSON() 一样。每一类按 id 末尾的序号排：
 * 各端 Y.Map 的遍历顺序不一定相同，排过序以后大家拿到的是同一份。
 */
export function docToJSON(doc: Y.Doc): ModelJSON {
  const out: ModelJSON = { format: (metaMap(doc).get('format') as number | undefined) ?? FORMAT_VERSION, nodes: [] }
  for (const [coll] of COLLECTIONS) out[coll] = []
  const parts = partsMap(doc)
  for (const [id, ymap] of parts.entries()) {
    const type = ymap.get(TYPE_KEY) as string | undefined
    const coll = type ? COLLECTION_OF.get(type) : undefined
    if (!coll) throw new Error(`Yjs part ${id}: unknown type ${String(type)}`)
    const rec: Rec = {}
    for (const [k, v] of ymap.entries()) if (k !== TYPE_KEY) rec[k] = v
    rec.id = id
    ;(out[coll] as Rec[]).push(rec)
  }
  for (const [coll] of COLLECTIONS) {
    ;(out[coll] as Rec[]).sort((x, y) => seqOf(String(x.id)) - seqOf(String(y.id)) || String(x.id).localeCompare(String(y.id)))
  }
  return out
}

/** 零件数，口径同 builder 里的 modelPartCount：管、板、滑梯、配件。 */
export function partCountOf(json: ModelJSON): number {
  const n = (v: Json) => (Array.isArray(v) ? v.length : 0)
  return n(json.tubes) + n(json.panels) + n(json.slides) + n(json.fittings)
}
