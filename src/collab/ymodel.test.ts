import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Y from 'yjs'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { parseQDF } from '../engine/qdfimport.js'
import { docFromJSON, docToJSON, docIsEmpty, partsMap, type ModelJSON } from './ymodel'
import { ModelHistory } from './history'

let pyramid: ModelJSON

beforeAll(async () => {
  await loadCatalog()
  const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
  const data = parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
  const m = new BuildModel()
  expect(m.loadJSON(data).ok).toBe(true)
  pyramid = m.toJSON() as ModelJSON
})

/** 引擎按一份 JSON 载入后再导出：比较时两边都走一遍 loadJSON/toJSON。 */
function normalized(json: ModelJSON) {
  const m = new BuildModel()
  expect(m.loadJSON(json).ok).toBe(true)
  return m.toJSON() as ModelJSON
}

function sortedIds(json: ModelJSON, coll: string) {
  return ((json[coll] as Array<{ id: string }>) || []).map(r => r.id).sort()
}

/** 两个文档互相补齐对方缺的更新（等于断开后重连）。 */
function exchange(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b))
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))
  Y.applyUpdate(b, toB, 'remote')
  Y.applyUpdate(a, toA, 'remote')
}

/** 实时连着的两个文档：一边的更新立刻送到另一边。 */
function link(a: Y.Doc, b: Y.Doc) {
  a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(b, u, 'remote') })
  b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(a, u, 'remote') })
}

/** 一个编辑端：引擎模型 + 编辑记录，外部变化时从文档重新载入，和 builder 里的做法一样。 */
function editor(doc: Y.Doc, tag: string) {
  const model = new BuildModel()
  model.idTag = tag
  const history = new ModelHistory(doc)
  const reload = () => { model.loadJSON(history.toJSON()) }
  history.onExternal(reload)
  reload()
  const edit = (fn: (m: BuildModel) => void) => {
    const before = JSON.stringify(model.toJSON())
    fn(model)
    history.commit(before, JSON.stringify(model.toJSON()))
  }
  return { model, history, edit }
}

function addTube(m: BuildModel, x: number, z: number) {
  const a = m.addNode(x, 0, z)
  const b = m.addNode(x + 40, 0, z)
  const tube = m.addTube(a.id, b.id, 'T35', 'blue', 35)
  if (!tube) throw new Error('addTube failed')
  return tube
}

describe('转换和导出', () => {
  it('造型 JSON 写进文档再导出，和原来一致', () => {
    const doc = docFromJSON(pyramid)
    expect(docIsEmpty(doc)).toBe(false)
    const out = docToJSON(doc)
    expect(normalized(out)).toEqual(pyramid)
    for (const coll of ['nodes', 'tubes', 'panels', 'clamps', 'textiles', 'fittings', 'slides', 'groups']) {
      expect(sortedIds(out, coll)).toEqual(sortedIds(pyramid, coll))
    }
  })

  it('每件零件是一个 Y.Map，字段和零件对象一致', () => {
    const doc = docFromJSON(pyramid)
    const tube = (pyramid.tubes as Array<Record<string, unknown>>)[0]
    const ymap = partsMap(doc).get(String(tube.id))!
    expect(ymap).toBeInstanceOf(Y.Map)
    expect(ymap.get('$type')).toBe('tube')
    for (const [k, v] of Object.entries(tube)) expect(ymap.get(k)).toEqual(v)
  })

  it('状态编码后在另一个文档里还原出同一座造型', () => {
    const doc = docFromJSON(pyramid)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    expect(docToJSON(copy)).toEqual(docToJSON(doc))
  })

  it('id 重复的造型就地报错', () => {
    const bad = { format: 2, nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }], tubes: [{ id: 'n1', a: 'n1', b: 'n1' }] } as ModelJSON
    expect(() => docFromJSON(bad)).toThrow(/duplicate part id n1/)
  })

  it('空文档', () => {
    expect(docIsEmpty(new Y.Doc())).toBe(true)
  })
})

describe('合并', () => {
  it('两边同时改不同零件，实时交换后两边一致且都保留', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    link(a, b)
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    const tubeId = String((pyramid.tubes as Array<{ id: string }>)[0].id)
    A.edit(m => { m.setColorOf('tube', tubeId, 'red') })
    let added = ''
    B.edit(m => { added = addTube(m, 500, 500).id })
    expect(A.model.tubes.get(tubeId).color).toBe('red')
    expect(B.model.tubes.get(tubeId).color).toBe('red')
    expect(A.model.tubes.has(added)).toBe(true)
    expect(docToJSON(a)).toEqual(docToJSON(b))
  })

  it('断开时两边各自改，重连后合并', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    const [t1, t2] = (pyramid.tubes as Array<{ id: string }>).map(t => t.id)
    let addA = ''
    let addB = ''
    A.edit(m => { m.setColorOf('tube', t1, 'red'); addA = addTube(m, 600, 0).id })
    B.edit(m => { m.setColorOf('tube', t2, 'green'); addB = addTube(m, 600, 300).id })
    B.edit(m => { m.removeTube(t1) })
    expect(addA).not.toBe(addB)
    exchange(a, b)
    const ja = docToJSON(a)
    expect(ja).toEqual(docToJSON(b))
    const ids = new Set((ja.tubes as Array<{ id: string }>).map(t => t.id))
    expect(ids.has(addA)).toBe(true)
    expect(ids.has(addB)).toBe(true)
    expect((ja.tubes as Array<{ id: string; color: string }>).find(t => t.id === t2)!.color).toBe('green')
    // B 删掉的管 A 改过颜色：A 只改了颜色字段，删掉整件的一方为准
    expect(ids.has(t1)).toBe(false)
    A.model.loadJSON(ja)
    expect(A.model.tubes.has(addB)).toBe(true)
  })

  it('同一件零件的不同字段，两边改的都留下', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    const id = String((pyramid.tubes as Array<{ id: string }>)[0].id)
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    A.edit(m => { m.setColorOf('tube', id, 'red') })
    B.edit(m => { m.addReinforcement([id]) })
    exchange(a, b)
    const tube = (docToJSON(a).tubes as Array<Record<string, unknown>>).find(t => t.id === id)!
    expect(tube.color).toBe('red')
    expect(tube.reinforced).toBe(B.model.tubes.get(id).reinforced ? true : undefined)
  })
})

describe('撤销只撤自己的', () => {
  it('撤销自己加的零件，别人加的留着', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    link(a, b)
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    let mine = ''
    let theirs = ''
    A.edit(m => { mine = addTube(m, 700, 0).id })
    B.edit(m => { theirs = addTube(m, 700, 300).id })
    expect(A.history.canUndo()).toBe(true)
    A.history.undo()
    expect(A.model.tubes.has(mine)).toBe(false)
    expect(A.model.tubes.has(theirs)).toBe(true)
    expect(B.model.tubes.has(mine)).toBe(false)
    expect(B.model.tubes.has(theirs)).toBe(true)
    A.history.redo()
    expect(B.model.tubes.has(mine)).toBe(true)
  })

  it('撤销自己改的颜色；别人随后改过同一字段时不覆盖别人的', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    link(a, b)
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    const [t1, t2] = (pyramid.tubes as Array<{ id: string; color: string }>).map(t => t.id)
    const orig1 = A.model.tubes.get(t1).color
    A.edit(m => { m.setColorOf('tube', t1, 'red') })
    A.edit(m => { m.setColorOf('tube', t2, 'red') })
    B.edit(m => { m.setColorOf('tube', t2, 'green') })
    A.history.undo()
    expect(A.model.tubes.get(t2).color).toBe('green')
    A.history.undo()
    expect(A.model.tubes.get(t1).color).toBe(orig1)
    expect(B.model.tubes.get(t1).color).toBe(orig1)
    expect(B.history.canUndo()).toBe(true)
  })

  it('撤销自己加的接头时，别人接在上面的管还连着，接头留下', () => {
    const a = docFromJSON(pyramid)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    link(a, b)
    const A = editor(a, 'a_')
    const B = editor(b, 'b_')
    let mine = { node: '', tube: '' }
    A.edit(m => {
      const n0 = m.addNode(800, 0, 0), n1 = m.addNode(840, 0, 0)
      const t = m.addTube(n0.id, n1.id, 'T35', 'blue', 35)!
      mine = { node: n1.id, tube: t.id }
    })
    let theirs = ''
    B.edit(m => {
      const up = m.addNode(840, 40, 0)
      theirs = m.addTube(mine.node, up.id, 'T35', 'red', 35)!.id
    })
    A.history.undo()
    expect(A.model.tubes.has(mine.tube)).toBe(false)
    expect(A.model.nodes.has(mine.node)).toBe(true)
    expect(A.model.tubes.has(theirs)).toBe(true)
    expect(B.model.tubes.has(theirs)).toBe(true)
    expect(docToJSON(a)).toEqual(docToJSON(b))
  })

  it('撤销删除：零件原样回来', () => {
    const doc = docFromJSON(pyramid)
    const A = editor(doc, '')
    const before = docToJSON(doc)
    const id = String((pyramid.tubes as Array<{ id: string }>)[3].id)
    A.edit(m => { m.removeTube(id) })
    expect(A.model.tubes.has(id)).toBe(false)
    A.history.undo()
    expect(docToJSON(doc)).toEqual(before)
    expect(A.model.tubes.has(id)).toBe(true)
  })

  it('撤销步数最多 60 步', () => {
    const doc = docFromJSON({ format: 2, nodes: [] })
    const A = editor(doc, '')
    for (let i = 0; i < 70; i++) A.edit(m => { addTube(m, i * 100, 0) })
    let n = 0
    while (A.history.canUndo()) { A.history.undo(); n++ }
    expect(n).toBe(60)
    expect(A.model.tubes.size).toBe(10)
  })
})
