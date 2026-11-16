import { beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as Y from 'yjs'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { parseQDF } from '../engine/qdfimport.js'
import { ModelHistory } from './history'
import { docFromJSON, docToJSON, type ModelJSON } from './ymodel'
import { anchorPoint, attachAnchor, partAnchorPoint } from './anchors'

beforeAll(() => loadCatalog())

it('真实造型的配件图钉随整体平移、协作同步、撤销和重做，地面图钉保持原位', () => {
  const model = new BuildModel()
  const data = parseQDF(readFileSync('src/data/A0128.qdf', 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
  expect(model.loadJSON(data).ok).toBe(true)
  const before = model.toJSON() as ModelJSON
  const doc = docFromJSON(before), history = new ModelHistory(doc), peer = new Y.Doc()
  const pins = (['nodes', 'tubes', 'panels', 'textiles', 'slides', 'fittings', 'clamps'] as const).flatMap(collection =>
    [...model[collection].keys()].map((id: string) => {
      const p = partAnchorPoint(model, id)!
      expect(p).not.toBeNull()
      return attachAnchor(model, { partId: id, point: [p[0] + 1, p[1] + 2, p[2] + 3] })
    }))
  expect(pins.length).toBeGreaterThan(20)
  const floor = { partId: null, point: [10, 0, 20] as [number, number, number] }
  const selected = new Map([...model.nodes.keys()].map(id => [id, 'node']))
  model.translateSelection(selected, 60, 5, -35)
  history.commit(JSON.stringify(before), JSON.stringify(model.toJSON()))
  const check = (m: BuildModel, delta: number[]) => {
    for (const pin of pins) expect(anchorPoint(m, pin)).toEqual(pin.point.map((n, i) => n + delta[i]))
    expect(anchorPoint(m, floor)).toEqual(floor.point)
  }
  check(model, [60, 5, -35])
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
  const other = new BuildModel(); expect(other.loadJSON(docToJSON(peer)).ok).toBe(true)
  check(other, [60, 5, -35])
  history.undo(); expect(model.loadJSON(history.toJSON()).ok).toBe(true); check(model, [0, 0, 0])
  history.redo(); expect(model.loadJSON(history.toJSON()).ok).toBe(true); check(model, [60, 5, -35])
  const legacy = { partId: pins[0].partId, point: pins[0].point }
  expect(anchorPoint(model, legacy)).toEqual(legacy.point)
  model.clear()
  expect(anchorPoint(model, pins[0])).toEqual(pins[0].point)
  history.destroy(); doc.destroy(); peer.destroy()
})
