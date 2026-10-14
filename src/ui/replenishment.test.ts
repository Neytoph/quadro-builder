import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { parseQDF } from '../engine/qdfimport.js'
import { compareInventory, computeBOM, neededParts } from '../engine/bom.js'
import { replenishmentCsv, replenishmentRows, replenishmentText } from './replenishment'
import type { InvRow } from '../store/EngineContext'
import { asBom } from '../store/EngineContext'

beforeAll(async () => { await loadCatalog() })

// 官方模型用于核对真实引擎用料；以下库存是隔离的计算测试输入。
describe('补件清单', () => {
  it.each(['A0001', 'C0013'])('%s 只复制真实用料的缺口，够用的零件不进入清单', id => {
    const model = new BuildModel()
    expect(model.loadJSON(parseQDF(readFileSync(`public/qdf/${id}.qdf`, 'utf8'), {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    })).ok).toBe(true)
    const bom = computeBOM(model)
    const needed = neededParts(bom)
    const inventory = Object.fromEntries(Object.entries(needed).map(([group, rows]) => [group, Object.fromEntries(rows)]))
    expect(replenishmentRows(compareInventory(bom, inventory).rows)).toEqual([])
    const [key, need] = [...needed.tubes][0]
    inventory.tubes[key] = need - 1
    const rows = compareInventory(bom, inventory).rows
    expect(replenishmentRows(rows)).toMatchObject([{ group: 'tubes', key, short: 1 }])
    const text = replenishmentText(rows, id, key => key)
    expect(text).toContain(`(${key}) ×1`)
    expect(text).toContain(id)
    expect(text).not.toContain('screw')
  })

  it('不同滑梯和接头身份独立扣减，不按套餐向量抵扣', () => {
    const bom = { tubes: [], connectors: [], panels: [], reinforcements: [], textiles: [], fittings: [], slides: [
      { id: 'slide_integral', count: 2 }, { id: 'slide_module', count: 1 },
    ] }
    const rows = compareInventory(bom, { fittings: { slide_integral: 1, slide_module: 9 } }).rows
    expect(replenishmentRows(rows)).toMatchObject([{ key: 'slide_integral', short: 1 }])
  })

  it('可选软装独立标注，历史螺丝及足量项不进入补件清单', () => {
    const rows: InvRow[] = [
      { group: 'fittings', key: 'textile', name: '布面', need: 3, owned: 1, ok: false, soft: true },
      { group: 'connectors', key: 'elbow', name: '弯头', need: 4, owned: 2, ok: false },
      { group: 'tubes', key: 'T35', name: '管', need: 1, owned: 9, ok: true },
      { group: 'screws', key: 'screw_tube', name: '螺丝', need: 40, owned: 0, ok: false },
    ]
    const text = replenishmentText(rows, '测试造型', key => key)
    expect(replenishmentRows(rows).map(row => [row.key, row.short])).toEqual([['textile', 2], ['elbow', 2]])
    expect(text.indexOf('(elbow)')).toBeLessThan(text.indexOf('replenish.optional'))
    expect(text.indexOf('replenish.optional')).toBeLessThan(text.indexOf('(textile)'))
    expect(text).not.toContain('(T35)')
    expect(text).not.toContain('screw_tube')
  })

  it('保留同类软装的实际用料尺寸，不给未知尺寸的库存分配规格', () => {
    const rows: InvRow[] = [{ group: 'fittings', key: 'textile', name: '布面', need: 3, owned: 1, ok: false, soft: true }]
    const bom = asBom({ textiles: [
      { id: 'textile', w: 40, h: 40, count: 1 },
      { id: 'textile', w: 40, h: 80, count: 2 },
    ] })
    const text = replenishmentText(rows, '尺寸核对', key => key, bom)
    expect(text).toContain('40×40 / 40×80 cm (textile) ×2')
    expect(text).not.toContain('40×40 cm (textile) ×1')
  })

  it('CSV 保持缺口、已有与需要列，可选项单列，保留中文编码', () => {
    const rows: InvRow[] = [
      { group: 'fittings', key: 'textile', name: '布面', need: 3, owned: 1, ok: false, soft: true },
      { group: 'tubes', key: 'T15', name: '管 15 cm', need: 8, owned: 6, ok: false },
      { group: 'tubes', key: 'T35', name: '管 35 cm', need: 1, owned: 9, ok: true },
    ]
    const csv = replenishmentCsv(rows, '我的造型', key => key)
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('我的造型,side.missing,T15,')
    expect(csv).toContain(',8,6,2,replenish.note\r\n')
    expect(csv).toContain('我的造型,replenish.optional,textile,')
    expect(csv).not.toContain('T35')
    expect(csv.indexOf('T15')).toBeLessThan(csv.indexOf('textile'))
  })

  it('CSV 正确保留逗号、引号、换行及以公式符号开头的用户名称', () => {
    const rows: InvRow[] = [{ group: 'tubes', key: 'T15', name: '管', need: 2, owned: 1, ok: false }]
    const csv = replenishmentCsv(rows, '=造型,"甲"\r\n第二行', key => key)
    expect(csv).toContain('"\'=造型,""甲""\r\n第二行",side.missing,T15,')
  })
})
