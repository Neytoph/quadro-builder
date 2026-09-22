// 料表导出自检：生成的 CSV 解析回来，逐类数量要和料表一致。
// 运行（仓库根目录）：npx vite-node scripts/check-bom-export.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const parts = JSON.parse(readFileSync(join(root, 'public/data/parts.json'), 'utf8'))
globalThis.localStorage = { getItem() { return null }, setItem() {}, removeItem() {} }
globalThis.fetch = async (url) => {
  if (String(url).includes('parts.json')) return { ok: true, json: async () => parts }
  throw new Error('unexpected fetch ' + url)
}
const { loadCatalog, buildableTubes, panels, geometry, setLang: setCatalogLang } = await import('../src/engine/catalog.js')
const { BuildModel } = await import('../src/engine/model.js')
const { computeBOM } = await import('../src/engine/bom.js')
const { parseQDF } = await import('../src/engine/qdfimport.js')
const { setLang } = await import('../src/engine/i18n.js')
const { geometricPreset, PLAY_MODULES } = await import('../src/data/presets.ts')
const { bomToCsv, bomSections } = await import('../src/ui/bomExport.ts')
await loadCatalog()
setLang('zh')

// EngineContext 里的 asBom 把引擎输出整形成界面用的样子，这里照着做一份最小的
const cleanText = (v) => String(v ?? '')
function asBom(raw) {
  const map = (list, kind, idKey) => (list || []).map((r) => ({
    key: String(r.key ?? r[idKey]), name: cleanText(r.name), count: Number(r.count),
    color: r.color || null, subtotal: Number(r.subtotal || 0), id: cleanText(r[idKey]), kind,
    w: r.w, h: r.h,
  }))
  const totals = raw.totals || {}
  return {
    tubes: map(raw.tubes, 'tubes', 'tubeId'),
    connectors: map(raw.connectors, 'connectors', 'type'),
    panels: map(raw.panels, 'panels', 'panelId'),
    slides: map(raw.slides, 'slides', 'id'),
    wheels: [],
    textiles: map(raw.textiles, 'textiles', 'id'),
    fittings: map(raw.fittings, 'fittings', 'id'),
    reinforcements: map(raw.reinforcements, 'reinforcements', 'id'),
    screws: map(raw.screws, 'screws', 'id'),
    totals: {
      tubes: Number(totals.tubes || 0), connectors: Number(totals.connectors || 0),
      panels: Number(totals.panels || 0), screws: Number(totals.screws || 0),
      other: Number(totals.other || 0), price: Number(totals.price || 0),
    },
    openEnds: 0,
  }
}

// 界面翻译在 i18n.tsx 里（React），脚本只要分区标题，用引擎的中文名凑一份
const TITLES = {
  'bom.tubes': '管子', 'bom.connectors': '连接件', 'bom.panels': '面板', 'bom.slides': '滑梯',
  'bom.wheels': '轮子', 'bom.textiles': '布件', 'bom.fittings': '配件',
  'bom.reinforcements': '加固', 'bom.screws': '螺丝', 'side.size': '尺寸', 'side.price': '材料约',
  'bomx.total': '零件合计', 'bomx.design': '设计', 'bomx.date': '导出日期', 'bomx.title': '零件清单',
  'bomx.col.section': '分类', 'bomx.col.part': '零件', 'bomx.col.color': '颜色',
  'bomx.col.count': '数量', 'bomx.col.owned': '拥有', 'bomx.col.short': '还缺', 'bomx.col.subtotal': '小计',
}
const t = (k) => TITLES[k] || k

function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  const body = text.replace(/^﻿/, '')
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

let fails = 0
function checkOne(label, model) {
  const bom = asBom(computeBOM(model))
  const sections = bomSections(bom, t)
  const csv = bomToCsv({ bom, name: label, sizeCm: [100, 100, 100], invRows: [], lang: 'zh', t })
  const rows = parseCsv(csv).filter((r) => r.length >= 4 && r[0] && r[0] !== t('bomx.col.section'))
  // CSV 里的零件行（尾部的合计几行列数不同或分类名对不上）
  const titles = new Set(sections.map((s) => s.title))
  const partRows = rows.filter((r) => titles.has(r[0]))
  const wantRows = sections.reduce((a, s) => a + s.rows.length, 0)
  const wantCount = sections.reduce((a, s) => a + s.rows.reduce((b, r) => b + r.count, 0), 0)
  const gotCount = partRows.reduce((a, r) => a + Number(r[3] || 0), 0)
  const okRows = partRows.length === wantRows
  const okCount = gotCount === wantCount
  const totalRow = parseCsv(csv).find((r) => r[0] === t('bomx.total'))
  const okTotal = totalRow && Number(totalRow[3]) === bom.totals.tubes + bom.totals.connectors + bom.totals.panels + bom.totals.other
  const ok = okRows && okCount && okTotal
  if (!ok) { fails++; process.exitCode = 1 }
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(16)} 行 ${partRows.length}/${wantRows}  件 ${gotCount}/${wantCount}  合计行 ${okTotal ? '对' : '错'}`)
}

for (const p of PLAY_MODULES) {
  const m = new BuildModel()
  m.loadJSON(geometricPreset(p.key))
  checkOne(p.key, m)
}
const qdfOpts = { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }
for (const id of ['A0001', 'A0128', 'B0051', 'C0106']) {
  const file = join(root, 'public/qdf', id + '.qdf')
  const m = new BuildModel()
  m.loadJSON(parseQDF(readFileSync(file, 'utf8'), qdfOpts))
  checkOne(id, m)
}
// 空模型：没有分区，CSV 只有表头和结尾几行
{
  const m = new BuildModel()
  const bom = asBom(computeBOM(m))
  const csv = bomToCsv({ bom, name: 'empty', sizeCm: null, invRows: [], lang: 'zh', t })
  const ok = bomSections(bom, t).length === 0 && csv.includes(t('bomx.col.section'))
  if (!ok) { fails++; process.exitCode = 1 }
  console.log(`${ok ? '✓' : '✗'} 空模型不出零件行`)
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过')
