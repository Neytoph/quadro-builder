import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {loadCatalog, buildableTubes, panels, geometry} from './catalog.js'
import {BuildModel} from './model.js'
import {parseQDF} from './qdfimport.js'
import {computeBOM, neededParts, compareInventory} from './bom.js'
import {inventoryCatalog} from '../data/inventoryCatalog'
import {asBom} from '../store/EngineContext'
import {bomToCsv} from '../ui/bomExport'

beforeAll(async () => {await loadCatalog()})
describe('模型材料与库存', () => {
  it.each(['A0001', 'C0013'])('%s 的材料价格、库存核验与导出保持一致', id => {
    const model = new BuildModel()
    expect(model.loadJSON(parseQDF(readFileSync(`public/qdf/${id}.qdf`, 'utf8'), {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2
    })).ok).toBe(true)
    const bom = computeBOM(model)
    expect(bom).not.toHaveProperty('screws')
    expect(bom.totals).not.toHaveProperty('screws')
    const needed = neededParts(bom)
    expect(needed).not.toHaveProperty('screws')
    const owned = Object.fromEntries(Object.entries(needed).map(([group, rows]) => [group, Object.fromEntries(rows)]))
    const compared = compareInventory(bom, {...owned, screws: {screw_tube: 1, screw_panel: 1}})
    expect(compared.feasible).toBe(true)
    expect(compared.rows.some(row => row.group === 'screws')).toBe(false)
    const view = asBom(bom)
    expect(view.totals.price).toBeCloseTo(bom.totals.price, 2)
    const csv = bomToCsv({bom: view, name: id, sizeCm: null, invRows: [], lang: 'zh', t: key => key})
    expect(csv).not.toMatch(/screw|螺丝|Schraube/i)
    const stock = inventoryCatalog()
    expect(stock).toHaveLength(99)
    expect(stock.some(row => row.id.startsWith('screw_'))).toBe(false)
  })
})
