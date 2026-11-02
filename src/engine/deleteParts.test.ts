import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BuildModel, BOLT_PART } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, buildableTubes, buildablePanels } from './catalog.js'
import { parseQDF } from './qdfimport.js'
import { connectorsForNode, inferConnectorType } from './bom.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 隔离验证真实编辑入口和历史记录；实际鼠标命中与绘制另用浏览器验收。
function editor(model: BuildModel) {
  const builder = Object.create(Builder.prototype)
  builder.model = model
  builder.mode = 'delete'
  builder.selection = new Map()
  builder.stepFrom = []
  builder.onNotice = () => {}
  builder.onHistoryChange = () => {}
  builder.refresh = () => {}
  builder.scene = {}
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return builder
}

function clickDelete(builder: Builder, id: string, kind: string, extra = {}) {
  builder.scene.pickForDelete = () => ({ data: { id, kind, ...extra } })
  builder._clickDelete({ clientX: 0, clientY: 0 })
}

function junction(imported = false) {
  const model = new BuildModel()
  const center = model.addNode(0, 40, 0)
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1]]
  const tubes = dirs.map(d => {
    const end = model.addNode(d[0] * 40, 40, d[2] * 40)
    return model.addTube(center.id, end.id, 'T35', 'blue', 35)!
  })
  if (imported) center.arms = dirs
  return { model, center, tubes }
}

function expectHistory(builder: Builder, before: object) {
  const after = builder.model.toJSON()
  const reopened = new BuildModel()
  expect(reopened.loadJSON(after).ok).toBe(true)
  expect(reopened.toJSON()).toEqual(after)
  builder.history.undo()
  expect(builder.model.toJSON()).toEqual(before)
  builder.history.redo()
  expect(builder.model.toJSON()).toEqual(after)
}

describe('删除后连接件自动适配', () => {
  for (const imported of [false, true]) {
    for (const batch of [false, true]) {
      it(`${imported ? '导入插口' : '自动接头'}通过${batch ? '选区' : '点击'}删管后从三通变弯头，再成为裸管端并清理空节点`, () => {
        const { model, center, tubes } = junction(imported)
        const before = model.toJSON(), builder = editor(model)
        const remove = (id: string) => {
          if (batch) {
            builder.selection = new Map([[id, 'tube']])
            builder.deleteSelection()
          } else clickDelete(builder, id, 'tube')
        }
        expect(inferConnectorType(model, center)).toBe('t')
        remove(tubes[0].id)
        expect(connectorsForNode(model, center)).toEqual(['elbow'])
        expect(model.nodes.has(tubes[0].b)).toBe(false)
        expect(model.tubes.get(tubes[1].id)).toEqual(tubes[1])
        if (imported) expect(model.nodes.get(center.id)!.arms).toEqual([[-1, 0, 0], [0, 0, 1]])
        expectHistory(builder, before)
        const elbow = model.toJSON()
        remove(tubes[2].id)
        expect(connectorsForNode(model, model.nodes.get(center.id)!)).toEqual([])
        expectHistory(builder, elbow)
        remove(tubes[1].id)
        expect(model.tubes.size).toBe(0)
        expect(model.nodes.size).toBe(0)
      })
    }
  }

  it('三通删除侧管后适配为直通', () => {
    const { model, center, tubes } = junction(true)
    clickDelete(editor(model), tubes[2].id, 'tube')
    expect(connectorsForNode(model, center)).toEqual(['straight'])
    expect(center.arms).toEqual([[1, 0, 0], [-1, 0, 0]])
  })

  it('点击自动接头删除直接相连的管子，并清理远端空节点', () => {
    const { model, center } = junction()
    const a = model.addNode(100, 40, 0), b = model.addNode(140, 40, 0)
    const unrelated = model.addTube(a.id, b.id, 'T35', 'red', 35)!
    const before = model.toJSON(), builder = editor(model)
    expect(builder._deleteHoverExtras({ data: { kind: 'node', id: center.id } })).toHaveLength(3)
    clickDelete(builder, center.id, 'node')
    expect([...model.tubes.values()]).toEqual([unrelated])
    expect([...model.nodes.keys()]).toEqual([a.id, b.id])
    expectHistory(builder, before)
  })

  it('点击手动通型恢复自动适配，管子保留且悬停不误标删除范围', () => {
    const { model, center } = junction(true)
    center.preferType = '6way'
    const before = model.toJSON(), builder = editor(model)
    expect(builder._deleteHoverExtras({ data: { kind: 'node', id: center.id } })).toBeNull()
    clickDelete(builder, center.id, 'node')
    expect(model.tubes.size).toBe(3)
    expect(center.preferType).toBeUndefined()
    expect(center.arms).toBeUndefined()
    expect(connectorsForNode(model, center)).toEqual(['t'])
    expectHistory(builder, before)
  })

  it('移除柔性栓及铰链后保留管子并清除配件标记', () => {
    const { model, center } = junction()
    center.part = BOLT_PART
    center.hinges = [0, 90]
    center.boltDeep = 2
    const builder = editor(model)
    clickDelete(builder, center.id, 'node', { hinge: 0 })
    expect(center.hinges).toHaveLength(1)
    clickDelete(builder, center.id, 'node')
    expect(model.tubes.size).toBe(3)
    expect(center.part).toBeUndefined()
    expect(center.hinges).toBeUndefined()
    expect(center.boltDeep).toBeUndefined()
  })

  for (const key of ['A0007', 'A0015', 'A0118', 'A0154']) {
    it(`真实官方${key}连续删管，撤销重做和保存重开一致`, () => {
      const model = new BuildModel()
      const data = parseQDF(readFileSync(`public/qdf/${key}.qdf`, 'utf8'), { tubes: buildableTubes(), panels: buildablePanels() })
      expect(model.loadJSON(data).ok).toBe(true)
      const builder = editor(model)
      const tubes = [...model.tubes.values()].filter(t => !t.arm && !t.link).slice(0, 5)
      for (const tube of tubes) {
        const before = model.toJSON()
        clickDelete(builder, tube.id, 'tube')
        expect(model.tubes.has(tube.id)).toBe(false)
        expectHistory(builder, before)
      }
    })
  }
})
