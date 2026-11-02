import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { computeBOM, neededParts, compareInventory } from './bom.js'
import { buildQDF, reinforcementProfiles } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { computeAssemblyPlan } from './assemblyPlan.js'
import { createCoreChannels } from './assemblyCoreChannels.js'
import { aluminiumConnectorSupport } from './reinforcement.js'
import { collectPositions } from './assemblyManual.js'
import * as Y from 'yjs'
import { docFromJSON, docToJSON, type ModelJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'

beforeAll(async () => { await loadCatalog() })

// 使用真实引擎建立独立直管列，检查物料与格式往返。
function line(lengths: number[]) {
  const model = new BuildModel(), tubes: string[] = []
  let previous = model.addNode(0, 0, 0), x = 0
  for (const length of lengths) {
    x += length + 5
    const next = model.addNode(x, 0, 0)
    const tube = model.addTube(previous.id, next.id, `T${length}`, 'red', length)
    if (!tube) throw new Error('直管列安装失败')
    tubes.push(tube.id); previous = next
  }
  return { model, tubes }
}
const rows = (model: BuildModel) => computeBOM(model).reinforcements.map((row: { id: string; count: number; len: number }) => [row.id, row.count, row.len])
const load = (data: unknown) => { const model = new BuildModel(); expect(model.loadJSON(data).ok).toBe(true); return model }

describe('内置铝管三种规格', () => {
  it('安装与取出通过正式Yjs历史撤销、重做', () => {
    const { model, tubes } = line([25, 25])
    const doc = docFromJSON(model.toJSON() as ModelJSON), history = new ModelHistory(doc)
    const before = JSON.stringify(model.toJSON())
    model.addReinforcement(tubes, 'reinforce55')
    history.commit(before, JSON.stringify(model.toJSON()))
    expect(rows(load(history.toJSON()))).toEqual([['reinforce55', 1, 55]])
    history.undo()
    expect(rows(load(history.toJSON()))).toEqual([])
    history.redo()
    expect(rows(load(history.toJSON()))).toEqual([['reinforce55', 1, 55]])
    const snapshot = model.toJSON()
    expect(model.moveSelection(new Map([[tubes[0], 'tube']]), 10, 0, 0)).toMatchObject({ ok: false, reason: 'accessory_mounts' })
    expect(model.toJSON()).toEqual(snapshot)
    history.destroy(); doc.destroy()
  })
  it.each([
    ['reinforce35', [35], 35, 40], ['reinforce35', [15, 15], 35, 40],
    ['reinforce55', [25, 25], 55, 60], ['reinforce55', [35, 15], 55, 60],
    ['reinforce80', [75], 75, 80], ['reinforce80', [35, 35], 75, 80],
  ] as const)('%s 在 %j 上安装，保存与QDF往返保留规格', (partId, lengths, length, span) => {
    const { model, tubes } = line([...lengths])
    expect(model.addReinforcement(tubes, partId)).toBe(true)
    expect(rows(model)).toEqual([[partId, 1, length]])
    expect(reinforcementProfiles(model)).toMatchObject([{ len: span, partId }])
    expect(createCoreChannels(model).channels[0].valid).toBe(true)
    const json = model.toJSON()
    expect(rows(load(json))).toEqual(rows(model))
    const qdf = buildQDF(model)
    const imported = load(parseQDF(qdf.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize }))
    expect(rows(imported)).toEqual(rows(model))
    const plan = computeAssemblyPlan(model)
    expect(plan.ledger.rows.filter((row: { conserved: boolean }) => !row.conserved)).toEqual([])
    expect(plan.diagnostics.filter((d: { code: string }) => d.code.includes('REINFORCEMENT'))).toEqual([])
  })

  it('尺寸不匹配、重复安装与转角安装保持原模型', () => {
    const { model, tubes } = line([35])
    const original = model.toJSON()
    expect(model.addReinforcement(tubes, 'reinforce55')).toBe(false)
    expect(model.toJSON()).toEqual(original)
    expect(model.addReinforcement(tubes, 'reinforce35')).toBe(true)
    expect(model.addReinforcement(tubes, 'reinforce35')).toBe(false)
    const other = model.addNode(40, 40, 0)
    const corner = model.addTube(model.tubes.get(tubes[0]).b, other.id, 'T35', 'red', 35)
    if (!corner) throw new Error('转角直管安装失败')
    model.removeReinforcement(tubes[0])
    expect(model.addReinforcement([tubes[0], corner.id], 'reinforce80')).toBe(false)
  })
})

describe('铝管连接器', () => {
  it('复制、移动、旋转和Yjs同步保留铝管分组与连接器引用', () => {
    const { model, tubes } = line([35, 35, 35, 35])
    expect(model.addReinforcement(tubes.slice(2), 'reinforce80')).toBe(true)
    expect(model.addReinforcement(tubes.slice(0, 2), 'reinforce80')).toBe(true)
    model.addAluminiumConnector(model.aluminiumConnectorMounts()[0])
    const initialRows = rows(model)
    const selection = new Map(tubes.map(id => [id, 'tube']))
    const fragment = model.extractSelection(selection)
    if (!fragment) throw new Error('未取得铝管片段')
    const copy = new BuildModel()
    copy.insertFragment(fragment, [0, 80, 100])
    expect(rows(copy)).toEqual(initialRows)
    expect(copy.aluminiumConnectorMounts()).toHaveLength(0)
    const copySelection = new Map([...copy.tubes.keys()].map(id => [id, 'tube']))
    copy.moveSelection(copySelection, 40, 0, 0, { merge: false })
    for (let turn = 0; turn < 4; turn++) {
      copy.rotateSelection(copySelection, 1, { merge: false })
      expect(copy.aluminiumConnectorMounts()).toHaveLength(0)
      expect(aluminiumConnectorSupport(copy, [...copy.fittings.values()][0])).toBeTruthy()
    }
    expect(rows(load(copy.toJSON()))).toEqual(initialRows)
    expect(copy.aluminiumConnectorMounts()).toHaveLength(0)
    const doc = docFromJSON(copy.toJSON() as ModelJSON), peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    expect(rows(load(docToJSON(peer)))).toEqual(initialRows)
    doc.destroy(); peer.destroy()
  })

  it('部分复制不保留半根铝管，损坏分组不覆盖当前模型', () => {
    const { model, tubes } = line([35, 35])
    model.addReinforcement(tubes, 'reinforce80')
    const fragment = model.extractSelection(new Map([[tubes[0], 'tube']]))
    if (!fragment) throw new Error('未取得局部片段')
    expect(fragment.tubes.every((tube: { reinforced?: boolean }) => !tube.reinforced)).toBe(true)
    const before = model.toJSON(), invalid = structuredClone(before)
    Object.assign(invalid.tubes[0], { reinforcement: { partId: 'reinforce55', group: tubes[0] } })
    expect(model.loadJSON(invalid)).toMatchObject({ ok: false, reason: 'data' })
    expect(model.toJSON()).toEqual(before)
  })

  it('两根相邻铝管独立计数，连接器可删除并保持JSON与QDF', () => {
    const { model, tubes } = line([35, 35])
    expect(model.addReinforcement([tubes[0]], 'reinforce35')).toBe(true)
    expect(model.addReinforcement([tubes[1]], 'reinforce35')).toBe(true)
    expect(model.aluminiumConnectorMounts()).toHaveLength(1)
    const connector = model.addAluminiumConnector(model.aluminiumConnectorMounts()[0])
    if (!connector) throw new Error('铝管连接器安装失败')
    expect(model.aluminiumConnectorMounts()).toHaveLength(0)
    expect(rows(model)).toEqual([['reinforce35', 2, 35], ['alu_connector', 1, 40]])
    expect(collectPositions(model).get('reinforcements:alu_connector')).toHaveLength(1)
    expect(neededParts(computeBOM(model)).reinforcements.get('alu_connector')).toBe(1)
    expect(compareInventory(computeBOM(model), { reinforcements: { reinforce35: 2, alu_connector: 1 } }).rows.filter((r: { group: string }) => r.group === 'reinforcements').every((r: { ok: boolean }) => r.ok)).toBe(true)
    expect(rows(load(model.toJSON()))).toEqual(rows(model))
    const imported = load(parseQDF(buildQDF(model).text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize }))
    expect(rows(imported)).toEqual(rows(model))
    expect(imported.aluminiumConnectorMounts()).toHaveLength(0)
    const plan = computeAssemblyPlan(model)
    expect(plan.ledger.rows.filter((row: { conserved: boolean }) => !row.conserved)).toEqual([])
    expect(plan.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual([])
    expect(plan.canExport).toBe(true)
    model.removeFitting(connector.id)
    expect(rows(model)).toEqual([['reinforce35', 2, 35]])
    expect(model.aluminiumConnectorMounts()).toHaveLength(1)
  })

  it('移除一根铝管或其承载管时，同时清理连接器', () => {
    for (const remove of ['reinforcement', 'tube']) {
      const { model, tubes } = line([35, 35])
      for (const tube of tubes) model.addReinforcement([tube], 'reinforce35')
      model.addAluminiumConnector(model.aluminiumConnectorMounts()[0])
      if (remove === 'tube') model.removeTube(tubes[0]); else model.removeReinforcement(tubes[0])
      expect(model.fittings.size).toBe(0)
      expect(rows(model)).toEqual([['reinforce35', 1, 35]])
    }
  })
})
