import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, getPartById, geometry } from './catalog.js'
import { componentMountsValid, componentVolumes } from './accessoryPack.js'
import { ropeCandidate, strapShape, tubeTieMount } from './confirmedComponentModel.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { computeBOM } from './bom.js'
import { docFromJSON, docToJSON } from '../collab/ymodel'
import { ModelHistory } from '../collab/history'
import { buildQDF } from './qdfexport.js'

beforeAll(loadCatalog)

// 使用真实模型API安装的隔离几何夹具；不代表实物绑扎或承载验证。
function fixture(points = [[0, 80, 0], [40, 80, 0], [0, 85, 0], [40, 85, 0]]) {
  const model = new BuildModel()
  const nodes = points.map(p => model.addNode(...p, { merge: false }))
  const a = model.addTube(nodes[0].id, nodes[1].id, 'T35', 'red', 35)!
  const b = model.addTube(nodes[2].id, nodes[3].id, 'T35', 'green', 35)!
  return { model, a, b }
}

describe('任意两根管之间的绑带', () => {
  it('目录有独立绑带，带宽接近管径；相贴管不套用绳子的8厘米最短距离', () => {
    const { model, a, b } = fixture()
    expect(getPartById('strap')).toMatchObject({ name: '绑带', bandWidth: 5 })
    expect(Math.abs(getPartById('strap').bandWidth - geometry().tubeRadius * 2)).toBeLessThan(.2)
    expect(model.ropeDiagnostics({ tube: a.id, t: .5 }, { tube: b.id, t: .5 }).valid).toBe(false)
    const probe = model.ropeDiagnostics({ tube: a.id, t: .5 }, { tube: b.id, t: .5 }, 'strap')
    expect(probe.valid).toBe(true)
    const part = model.addConfirmedComponent(probe, 'blue')!
    expect(part.kind).toBe('strap')
    expect(part.mounts.map((m: { role: string }) => m.role)).toEqual(['wrap', 'wrap'])
    expect(part.mounts.map((m: { width: number }) => m.width)).toEqual([5, 5])
    expect(componentMountsValid(model, part)).toBe(true)
  })

  it.each([
    [[0, 80, 0], [40, 80, 0], [20, 60, 5], [20, 100, 5]],
    [[0, 80, 0], [40, 80, 0], [0, 90, 10], [28.284271, 118.284271, 10]],
    [[0, 80, 0], [40, 80, 0], [0, 80, 300], [40, 80, 300]],
  ].map(points => ({ points })))('两根管无需平行、同高或组成框格，也不沿用绳子240厘米上限：$points', ({ points }) => {
    const { model, a, b } = fixture(points)
    const probe = model.ropeDiagnostics({ tube: a.id, t: .37 }, { tube: b.id, t: .68 }, 'strap')
    expect(probe.valid).toBe(true)
    expect(model.addConfirmedComponent(probe, 'blue')).toBeTruthy()
  })

  it('弯管定位点跟随真实圆弧，绑带可以连接弯管与直管', () => {
    const model = new BuildModel(), start = model.addNode(0, 80, 0)
    const bow = model.extendBow(start.id, [1, 0, 0], [0, 1, 0], 'TC35', 'yellow', 40)!.tube!
    const x = 40 * Math.SQRT1_2, y = 120 - 40 * Math.SQRT1_2
    const a = model.addNode(x - 20, y, 10), b = model.addNode(x + 20, y, 10)
    const tube = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const mount = tubeTieMount(model, bow.id, [x, y, .5], 'strap')!
    expect(mount.t).toBeCloseTo(.5, 10)
    expect(mount.pos[0]).toBeCloseTo(x, 10)
    expect(mount.pos[1]).toBeCloseTo(y, 10)
    expect(model.ropeDiagnostics(mount, { tube: tube.id, t: .5 }, 'strap').valid).toBe(true)
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, fittingKind: 'strap' })
    expect(builder._ropeMountAt(bow.id, { x, y, z: 0 }).t).toBeCloseTo(.5, 10)
  })

  it('不能连接同一根管、虚拟桥或缺失引用，宽带避开管端接头', () => {
    const { model, a, b } = fixture()
    expect(ropeCandidate(model, { tube: a.id, t: .5 }, { tube: a.id, t: .7 }, 'strap').valid).toBe(false)
    expect(ropeCandidate(model, { tube: a.id, t: .5 }, { tube: 'missing', t: .5 }, 'strap').valid).toBe(false)
    expect(ropeCandidate(model, { tube: a.id, t: .05 }, { tube: b.id, t: .5 }, 'strap').valid).toBe(false)
    expect(tubeTieMount(model, a.id, [0, 80, 0], 'strap')!.t).toBe(.125)
    Object.assign(b, { link: true })
    expect(ropeCandidate(model, { tube: a.id, t: .5 }, { tube: b.id, t: .5 }, 'strap').valid).toBe(false)
  })

  it('原生和Yjs保存保持两根管的参数位置，删除一根承载管会删除绑带', () => {
    const { model, a, b } = fixture()
    const probe = model.ropeDiagnostics({ tube: a.id, t: .3 }, { tube: b.id, t: .7 }, 'strap')
    const part = model.addConfirmedComponent(probe, 'black')!
    const saved = model.toJSON(), reopened = new BuildModel(), doc = docFromJSON(saved)
    expect(reopened.loadJSON(docToJSON(doc)).ok).toBe(true)
    expect(reopened.fittings.get(part.id)).toMatchObject({ kind: 'strap', mounts: part.mounts, ropeLength: part.ropeLength })
    expect(componentMountsValid(reopened, reopened.fittings.get(part.id)!)).toBe(true)
    const fragment = model.extractSelection(new Map([...model.nodes.keys()].map(id => [id, 'node'])))
    const copied = model.insertFragment(fragment, [200, 80, 0])
    const copy = model.fittings.get(copied.fittings[0])!
    expect(copy.kind).toBe('strap')
    expect(copy.supportTubes.every((id: string) => (copied.tubes as string[]).includes(id))).toBe(true)
    expect(componentMountsValid(model, copy)).toBe(true)
    reopened.removeTube(a.id)
    expect(reopened.fittings.has(part.id)).toBe(false)
    expect(model.fittings.has(part.id)).toBe(true)
    doc.destroy()
  })

  it('网格具有两端宽带和两侧连接带，料表独立计为一条绑带', () => {
    const { model, a, b } = fixture()
    const part = model.addConfirmedComponent(model.ropeDiagnostics({ tube: a.id, t: .5 }, { tube: b.id, t: .5 }, 'strap'), 'black')!
    const geometries = new Map<string, THREE.BufferGeometry>(), scene = {
      _materials: {} as Record<string, THREE.Material>, _cachedGeo: (key: string, make: () => THREE.BufferGeometry) => {
        if (!geometries.has(key)) geometries.set(key, make())
        return geometries.get(key)!
      },
    }
    const meshes = confirmedComponentMeshes(scene, model, part)
    expect(meshes).toHaveLength(4)
    expect(meshes.filter(m => m.name.startsWith('strap-wrap'))).toHaveLength(2)
    expect(strapShape(model, part)!.width).toBe(5)
    for (const mesh of meshes) expect([...mesh.geometry.attributes.position.array].every(Number.isFinite)).toBe(true)
    expect(computeBOM(model).fittings.filter(row => row.kind === 'strap')).toHaveLength(1)
    geometries.forEach(g => g.dispose())
    Object.values(scene._materials).forEach((m: THREE.Material) => m.dispose())
  })

  it('两次点击安装使用绑带身份，悬停不写数据，第一端遮挡时仍能选第二管，撤销重做保持引用', () => {
    const { model, a, b } = fixture()
    // 射线输入适配仅用于控制器回归；模型、预览诊断和历史均调用真实实现。
    let hit = { data: { kind: 'tube', id: a.id }, point: { x: 12, y: 80, z: 0 } }
    let firstMarker = false
    const scene = {
      pickTube: () => hit,
      pickHandle: () => firstMarker ? { data: { ropeFirst: true } } : null,
      cameraPosition: () => [20, 120, 100],
      clearInstallationPreview: () => {},
      showInstallationPreview: () => {},
      addHandle: (position: number[], data: Record<string, unknown>) => {
        const mesh = new THREE.Object3D(); mesh.position.fromArray(position); mesh.userData = data; return mesh
      },
      moveHandle: (mesh: THREE.Object3D, pos: number[]) => mesh.position.fromArray(pos),
      setHandleVisible: (mesh: THREE.Object3D, visible: boolean) => { mesh.visible = visible },
    }
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, scene, mode: 'fitting', fittingKind: 'strap', fittingPart: 'strap', color: 'blue',
      selection: new Map(), stepFrom: [], _tubeHandles: new Map(), onNotice: () => {}, onHistoryChange: () => {}, onChange: () => {},
      refresh: () => { builder._tubeHandles = new Map(); builder._buildFittingHandles() } })
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    builder._buildFittingHandles()
    const click = () => builder._clickFitting({ clientX: 20, clientY: 20 })
    click()
    expect(builder.installationPreview.partId).toBe('strap')
    expect(model.fittings.size).toBe(0)
    hit = { data: { kind: 'tube', id: b.id }, point: { x: 28, y: 85, z: 0 } }
    firstMarker = true
    builder._showRopeHover(builder._ropePointerMount(20, 20).mount)
    expect(model.fittings.size).toBe(0)
    click()
    const part = [...model.fittings.values()][0]
    expect(part.kind).toBe('strap')
    expect(part.mounts.map((m: { tube: string; t: number }) => [m.tube, m.t])).toEqual([[a.id, .3], [b.id, .7]])
    builder.undo(); expect(model.fittings.size).toBe(0)
    builder.redo(); expect(model.fittings.has(part.id)).toBe(true)
    expect(buildQDF(model).warnings).toContainEqual({ code: 'omitted_accessory', partId: 'strap', id: part.id })
    builder.readOnly = true
    const saved = model.toJSON(); click(); expect(model.toJSON()).toEqual(saved)
  })

  it('损坏的绑带挂点明确无效，碰撞检查及渲染形状查询不抛异常', () => {
    const { model, a, b } = fixture()
    const part = model.addConfirmedComponent(model.ropeDiagnostics({tube:a.id,t:.5},{tube:b.id,t:.5},'strap'),'black')!
    for (const mount of [null, {tube:'missing',t:.5}, {tube:a.id,t:NaN}]) {
      const damaged = {...part,mounts:[mount,part.mounts[1]]}
      expect(componentMountsValid(model,damaged)).toBe(false)
      expect(strapShape(model,damaged)).toBeNull()
      expect(componentVolumes(model,damaged)).toEqual([])
    }
  })
})
