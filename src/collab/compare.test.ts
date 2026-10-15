import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Y from 'yjs'
import { loadCatalog, buildableTubes, panels, geometry } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { parseQDF } from '../engine/qdfimport.js'
import { diffBom, diffModels } from './compare'
import { docFromJSON, docToJSON, type ModelJSON } from './ymodel'
import { ModelHistory } from './history'
import { docFromBase64, stateBase64 } from './planSession'

let pyramid: ModelJSON
beforeAll(async () => {
  await loadCatalog()
  const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
  const m = new BuildModel()
  m.loadJSON(parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
  pyramid = m.toJSON() as ModelJSON
})

describe('版本对照', () => {
  it('存成版本的状态还原以后，和后来的样子比出增、减、改', () => {
    const doc = docFromJSON(pyramid)
    const v1 = stateBase64(doc)
    const history = new ModelHistory(doc)
    const m = new BuildModel()
    m.loadJSON(docToJSON(doc))
    const before = JSON.stringify(m.toJSON())
    const real = [...m.tubes.values()].filter(t => !t.arm && !t.link && t.color !== 'red').map(t => t.id as string)
    const [t1, t2] = real
    expect(m.setColorOf('tube', t1, 'red')).toBe(true)
    m.removeTube(t2)
    const a = m.addNode(900, 0, 0), b = m.addNode(940, 0, 0)
    const added = m.addTube(a.id, b.id, 'T35', 'blue', 35)!
    history.commit(before, JSON.stringify(m.toJSON()))

    const left = docToJSON(docFromBase64(v1))
    const right = docToJSON(doc)
    const d = diffModels(left, right)
    expect(d.added.has(added.id)).toBe(true)
    expect(d.removed.has(t2)).toBe(true)
    expect(d.changed.has(t1)).toBe(true)
    expect(d.added.has(t1) || d.removed.has(t1)).toBe(false)

    const rows = diffBom(left, right)
    expect(rows.length).toBeGreaterThan(0)
    const tubeRows = rows.filter(r => r.group === 'tubes')
    const net = tubeRows.reduce((s, r) => s + r.right - r.left, 0)
    expect(net).toBe(0)
    expect(Y.encodeStateVector(doc).length).toBeGreaterThan(0)
  })

  it('一样的两份没有差异', () => {
    expect(diffModels(pyramid, pyramid)).toEqual({ added: new Set(), removed: new Set(), changed: new Set() })
    expect(diffBom(pyramid, pyramid)).toEqual([])
  })
})
