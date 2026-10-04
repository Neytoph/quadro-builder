import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { componentMountsValid } from './accessoryPack.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { SceneManager } from './scene.js'
import { docFromJSON, applyDelta, docToJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'

beforeAll(async () => { await loadCatalog() })

describe('审查结构回归：真实模型、QDF、Yjs 与 Three CPU 几何', () => {
  it('卡扣 QDF 往返后仍可旋转，删除无关管保留卡扣', () => {
    const original = new BuildModel()
    const a = original.addNode(0, 40, 0), b = original.addNode(40, 40, 0)
    const support = original.addTube(a.id, b.id, 'T35', 'blue', 35)!
    expect(original.addTubeClamp(support.id, [20, 40, 5], 'hole_1')).toBeTruthy()
    const c = original.addNode(100, 40, 0), d = original.addNode(140, 40, 0)
    original.addTube(c.id, d.id, 'T35', 'blue', 35)
    const parsed = parseQDF(buildQDF(original).text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const reopened = new BuildModel()
    expect(reopened.loadJSON(parsed).ok).toBe(true)
    const clamp = [...reopened.nodes.values()].find(n => n.part === 'hole_1')!
    expect(reopened.tubes.has(clamp.clampOn!.tubeId)).toBe(true)
    expect(reopened.rotateTubeClamp(clamp.id)).toBe(true)
    const unrelated = [...reopened.tubes.values()].find(t => reopened.nodes.get(t.a)!.x > 90)!
    reopened.removeTube(unrelated.id)
    expect(reopened.nodes.has(clamp.id)).toBe(true)
    const legacy = reopened.toJSON() as any
    const node = legacy.nodes.find((n: any) => n.id === clamp.id)
    node.clampOn.id = node.clampOn.tubeId
    delete node.clampOn.tubeId
    expect(reopened.loadJSON(legacy).ok).toBe(true)
    expect(reopened.nodes.get(clamp.id)!.clampOn!.tubeId).toBe(node.clampOn.id)
    node.clampOn.id = 'missing'
    const before = reopened.toJSON()
    expect(reopened.loadJSON(legacy).ok).toBe(false)
    expect(reopened.toJSON()).toEqual(before)
  })

  it.each(['rope', 'textile', 'textile_round_fourway', 'trampoline'])('%s 的远端组件依赖在本地撤销后完整恢复', id => {
    const fixture = createConfirmedComponentFixture(id)
    const complete = fixture.model.toJSON()
    const support = structuredClone(complete)
    support.panels = []; support.fittings = []
    const empty = new BuildModel().toJSON()
    const doc = docFromJSON(empty)
    const history = new ModelHistory(doc)
    history.commit(JSON.stringify(empty), JSON.stringify(support))
    applyDelta(doc, support, complete, { name: 'other-user' })
    history.undo()
    const loaded = new BuildModel()
    expect(loaded.loadJSON(docToJSON(doc)).ok).toBe(true)
    const part = [...loaded.panels.values(), ...loaded.fittings.values()][0]
    expect(part).toBeTruthy()
    expect(componentMountsValid(loaded, part)).toBe(true)
    history.redo()
    expect(loaded.loadJSON(docToJSON(doc)).ok).toBe(true)
    expect(componentMountsValid(loaded, [...loaded.panels.values(), ...loaded.fittings.values()][0])).toBe(true)
    history.destroy(); doc.destroy()
  })

  it('平移后的 cloth 共用局部曲面；保留仍被引用几何并释放清空后的缓存', () => {
    // 调用实际 SceneManager 方法，不创建 WebGLRenderer；仅验证 CPU 资源生命周期。
    const scene = Object.create(SceneManager.prototype)
    scene.scene = new THREE.Scene(); scene._keepGeos = new Set(); scene._materials = {}
    const first = createConfirmedComponentFixture('textile')
    const moved = createConfirmedComponentFixture('textile', { offset: [160, 40, 90] })
    const groupA = new THREE.Group(), groupB = new THREE.Group()
    scene.scene.add(groupA, groupB)
    const meshesA = confirmedComponentMeshes(scene, first.model, first.part)
    const meshesB = confirmedComponentMeshes(scene, moved.model, moved.part)
    groupA.add(...meshesA); groupB.add(...meshesB)
    const fabricA = meshesA.find((mesh: THREE.Mesh) => mesh.name.startsWith('fabric:'))!
    const fabricB = meshesB.find((mesh: THREE.Mesh) => mesh.name.startsWith('fabric:'))!
    expect(fabricA.geometry).toBe(fabricB.geometry)
    let disposed = 0
    fabricA.geometry.addEventListener('dispose', () => { disposed++ })
    scene._disposeGroup(groupA)
    expect(disposed).toBe(0)
    scene._disposeGroup(groupB)
    expect(disposed).toBe(1)
    expect(scene._fitGeos.size).toBe(0)
    expect(scene._keepGeos.size).toBe(0)
    for (let i = 0; i < 12; i++) {
      const { model, part } = createConfirmedComponentFixture('textile', { offset: [i * 10, 0, 0] })
      groupA.add(...confirmedComponentMeshes(scene, model, part))
      scene._disposeGroup(groupA)
      expect(scene._fitGeos.size).toBe(0)
    }
  })
})
