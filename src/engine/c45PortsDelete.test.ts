import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from './config.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'
import { resolveNodeConnection } from './bom.js'

beforeAll(async () => { await loadCatalog() })

function fixture() {
  const model = new BuildModel()
  const lower = model.addNode(0, 40, 0)
  const rail = model.extend(lower.id, [1, 0, 0], 'T35', 'green', 35, 40)!
  const diagonal = model.extendC45Diagonal(lower.id, [Math.SQRT1_2, Math.SQRT1_2, 0], [-1, 0, 0], 'T35', 'red', 35, 40, C45_SLEEVE_LEN, C45_ARM_LEN)!
  const upper = model.addC45Adapter(diagonal.node!.id, [0, 0, 1], [0, Math.SQRT1_2, -Math.SQRT1_2], C45_SLEEVE_LEN, C45_ARM_LEN)!
  return { model, lower, rail: rail.tube!, diagonal, upper: upper.body! }
}

function editor(model: BuildModel, id: string) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'select'
  builder.selection = new Map([[id, 'node']])
  builder.stepFrom = []
  builder.refresh = () => {}
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

describe('45°件独立拆卸及真实接管方向', () => {
  it('旧删除存档的单臂残留不会在重新打开及旋转后恢复成接头', () => {
    const { model, diagonal, upper } = fixture()
    model.removeC45(upper.id)
    const placed = model.addC45OnTube(diagonal.node!.id, [0, 1, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
    placed.base!.arms = [[0, 1, 0]]
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(reopened.nodes.get(placed.base!.id)!.arms).toBeUndefined()
    const builder = editor(reopened, placed.body!.id)
    for (let i = 0; i < 4; i++) {
      expect(builder.rotateSelectionBy(1)).toBe(true)
      expect(resolveNodeConnection(reopened, placed.base!.id).types).toEqual([])
    }
  })

  it('删除手动弯头清掉全部插臂，旋转及重开后只保留空套筒锚点，仍可装回接管', () => {
    const { model, diagonal, upper } = fixture()
    model.removeC45(upper.id)
    const placed = model.addC45OnTube(diagonal.node!.id, [0, 1, 0], C45_SLEEVE_LEN, C45_ARM_LEN)!
    const base = placed.base!, builder = editor(model, base.id)
    expect(builder._applyConnectorType(base, 'elbow')).toBe(true)
    const horizontal = model.extend(base.id, [1, 0, 0], 'T35', 'blue', 35, 40)!
    model.removeTube(horizontal.tube!.id)
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before = model.toJSON()
    const tubes = before.tubes
    builder.deleteSelection()
    expect(base.arms).toBeUndefined()
    expect(base.armDirs).toBeUndefined()
    expect(base.preferType).toBeUndefined()
    expect(resolveNodeConnection(model, base.id).types).toEqual([])
    expect(model.toJSON().tubes).toEqual(tubes)
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
    builder.history.redo()
    builder.selection = new Map([[placed.body!.id, 'node']])
    expect(builder.rotateSelectionBy(1)).toBe(true)
    expect(resolveNodeConnection(model, base.id).types).toEqual([])
    expect(builder.rotateSelectionBy(-1)).toBe(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    const reopenedBase = reopened.nodes.get(base.id)!
    expect(resolveNodeConnection(reopened, reopenedBase).types).toEqual([])
    const reeditor = editor(reopened, base.id)
    expect(reeditor._applyConnectorType(reopenedBase, 'elbow')).toBe(true)
    expect(reopened.extend(base.id, [1, 0, 0], 'T35', 'blue', 35, 40)!.tube).toBeTruthy()
  })

  it('删除上端承载接头时，下端空45°件仍独立保留并可撤销', () => {
    const { model, diagonal, rail } = fixture()
    const lowerBody = { ...diagonal.body! }
    const lowerArm = [...model.tubes.values()].find(t => t.arm && (t.a === lowerBody.id || t.b === lowerBody.id))!
    const builder = editor(model, diagonal.node!.id)
    const before = model.toJSON()
    builder.deleteSelection()
    expect(model.nodes.get(lowerBody.id)).toEqual(lowerBody)
    expect(model.tubes.get(lowerArm.id)).toEqual(lowerArm)
    expect(model.tubes.get(rail.id)).toEqual(rail)
    expect(model.c45ArmDir(model.nodes.get(lowerBody.id))).toBeTruthy()
    builder.history.undo()
    expect(model.toJSON()).toEqual(before)
  })

  it('单独拆下斜管会保留两端已安装的45°件；保存重开仍保留', () => {
    const { model, diagonal, upper } = fixture()
    model.removeTube(diagonal.tube!.id)
    expect(model.nodes.get(diagonal.body!.id)!.c45body).toBe(true)
    expect(model.nodes.get(upper.id)!.c45body).toBe(true)
    const reopened = new BuildModel()
    reopened.loadJSON(model.toJSON())
    expect(reopened.toJSON()).toEqual(model.toJSON())
  })

  it('删其他位置的管子不会清掉尚未接管的45°件', () => {
    const { model, rail, upper } = fixture()
    model.removeTube(rail.id)
    expect(model.nodes.get(upper.id)!.c45body).toBe(true)
  })

  it('承载45°件的自动直通不提供额外直管或弯管入口，换通型后使用真实空口', () => {
    const { model, lower } = fixture()
    const before = model.toJSON()
    for (const dir of [[0, 1, 0], [0, -1, 0]]) {
      expect(model.canExtendFrom(lower, dir)).toBe(false)
      expect(model.extend(lower.id, dir, 'T35', 'blue', 35, 40)).toBeNull()
      expect(model.extendBow(lower.id, dir, [0, 0, 1], 'TC1', 'blue', 40)).toBeNull()
    }
    expect(model.toJSON()).toEqual(before)
    expect(model.canExtendFrom(lower, [0, 0, 1])).toBe(false)
    expect(model.canExtendFrom(lower, [0, 0, -1])).toBe(false)
    const builder = editor(model, lower.id)
    expect(builder._nodeAcceptsConnector(lower, 'elbow')).toBe(false)
    const handles: number[][] = []
    builder.scene = { addHandle: (_p: number[], data: { dir: number[] }) => handles.push(data.dir) }
    builder._addBuildHandles(lower)
    expect(handles.some(dir => Math.abs(dir[1]) > 0.99)).toBe(false)
    expect(builder._applyConnectorType(lower, '6way')).toBe(true)
    expect(model.canExtendFrom(lower, [0, 1, 0])).toBe(true)
  })

  it('竖向承载接头同样保留通型限制，上端直角二通仍可水平接管', () => {
    const model = new BuildModel()
    const base = model.addNode(0, 40, 0)
    model.addC45Adapter(base.id, [0, 1, 0], [Math.SQRT1_2, -Math.SQRT1_2, 0], C45_SLEEVE_LEN, C45_ARM_LEN)
    expect(model.extend(base.id, [0, -1, 0], 'T35', 'blue', 35, 40)!.tube).toBeTruthy()
    for (const dir of [[1, 0, 0], [-1, 0, 0]]) expect(model.canExtendFrom(base, dir)).toBe(false)
    expect(model.canExtendFrom(base, [0, 0, 1])).toBe(false)
    const { model: other, diagonal, upper } = fixture()
    other.removeC45(upper.id)
    const end = diagonal.node!
    const placed = other.addC45OnTube(end.id, [0, 1, 0], C45_SLEEVE_LEN, C45_ARM_LEN)
    expect(placed!.body).toBeTruthy()
    const builder = editor(other, placed!.base!.id)
    expect(builder._applyConnectorType(placed!.base!, 'elbow')).toBe(true)
    expect(other.extend(placed!.base!.id, [1, 0, 0], 'T35', 'blue', 35, 40)!.tube).toBeTruthy()
  })

  it('裸斜管口只提供直接插入45°件的安装点，避免同心箭头放错端', () => {
    const { model, diagonal, upper } = fixture()
    model.removeC45(upper.id)
    const builder = editor(model, diagonal.node!.id)
    const handles: Array<{ nodeId: string; inTube?: boolean }> = []
    builder.selectedNodeId = diagonal.node!.id
    builder.scene = { addHandle: (_p: number[], data: typeof handles[number]) => handles.push(data) }
    builder._buildC45Handles()
    expect(handles).toHaveLength(1)
    expect(handles[0].inTube).toBe(true)
  })
})
