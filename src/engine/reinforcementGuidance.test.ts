import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { SceneManager } from './scene.js'
import { DEFAULT_GRADE } from './colorTune.js'
import { loadCatalog } from './catalog.js'
import { reinforcementGuide, aluminiumConnectorDisplay } from './reinforcement.js'
import { partEnvelope } from './assemblyCollision.js'

beforeAll(async () => { await loadCatalog() })

function addLine(model: BuildModel, lengths: number[], offset = 0, axis = [1, 0, 0]) {
  let point = model.addNode(0, offset, 0), position = 0
  const ids: string[] = []
  for (const length of lengths) {
    position += length + 5
    const next = model.addNode(position * axis[0], offset + position * axis[1], position * axis[2])
    const tube = model.addTube(point.id, next.id, `T${length}`, 'red', length)
    if (!tube) throw new Error('检查框架无法安装直管')
    ids.push(tube.id); point = next
  }
  return ids
}

describe('加固模式的可安装位置', () => {
  it('三种规格按真正的安装路径给出橙色目标，不采用结构加固建议', () => {
    const model = new BuildModel()
    const a = addLine(model, [35]), b = addLine(model, [25, 25], 60), c = addLine(model, [75], 120)
    expect([...reinforcementGuide(model, 'reinforce35').installable]).toEqual(a)
    expect([...reinforcementGuide(model, 'reinforce55').installable]).toEqual(b)
    expect([...reinforcementGuide(model, 'reinforce80').installable]).toEqual(c)
    model.addReinforcement(a, 'reinforce35')
    expect(reinforcementGuide(model, 'reinforce35').installable.size).toBe(0)
  })

  it('先选一根后，仅标出能完成该根铝管的相邻承载管', () => {
    const model = new BuildModel(), ids = addLine(model, [35, 35, 35, 35])
    const guide = reinforcementGuide(model, 'reinforce80', ids[1])
    expect([...guide.installable].sort()).toEqual([ids[0], ids[2]].sort())
    for (const id of guide.installable) expect(model.reinforcementPaths(ids[1], 'reinforce80').some(path => path.tubeIds.includes(id))).toBe(true)
  })

  it('连接器只标出真实交接处，远端承载管和已占用位置不提供安装', () => {
    const model = new BuildModel(), ids = addLine(model, [35, 35, 35, 35])
    model.addReinforcement(ids.slice(0, 2), 'reinforce80')
    model.addReinforcement(ids.slice(2), 'reinforce80')
    const guide = reinforcementGuide(model, 'alu_connector')
    expect(guide.mounts).toHaveLength(1)
    expect([...guide.installable].sort()).toEqual([guide.mounts[0].nodeId, ids[1], ids[2]].sort())
    // 直接调用真实鼠标可用性判断；无需启动WebGL来核对指针语义。
    const builder = Object.assign(Object.create(Builder.prototype), { model, reinforcementPartId: 'alu_connector' })
    expect(builder._reinforceUsable(guide.mounts[0].nodeId)).toBe(true)
    expect(builder._reinforceUsable(ids[0])).toBe(false)
    model.addAluminiumConnector(guide.mounts[0])
    expect(reinforcementGuide(model, 'alu_connector').installable.size).toBe(0)
  })
})

describe('铝管连接器的旁置显示', () => {
  it.each([[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]])('轴线%j的可见几何与安装包络一致', (...axis) => {
    const model = new BuildModel(), ids = addLine(model, [35, 35], 40, axis)
    for (const id of ids) model.addReinforcement([id], 'reinforce35')
    const fitting = model.addAluminiumConnector(model.aluminiumConnectorMounts()[0])
    if (!fitting) throw new Error('检查连接器安装失败')
    const display = aluminiumConnectorDisplay(fitting)
    expect(display.bounds[1][1] - display.bounds[1][0]).toBeCloseTo(1.8)
    expect(display.bounds[2][1] - display.bounds[2][0]).toBeCloseTo(0.7)
    // 使用真实Scene几何和材质方法，完整WebGL画面另在浏览器验收。
    const scene = Object.assign(Object.create(SceneManager.prototype), { _materials: {}, _grade: DEFAULT_GRADE })
    const mesh = scene._fittingMeshes(fitting)[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>
    mesh.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(mesh), envelope = partEnvelope(model, fitting.id)[0]
    expect(box.getCenter(new THREE.Vector3()).toArray().map(v => Math.round(v * 1000))).toEqual(envelope.pos.map((v: number) => Math.round(v * 1000)))
    const limits = display.bounds
    expect(limits[2][1]).toBeCloseTo(-6.55) // 距真实铝管最外缘6.48cm仅0.07cm。
    const geometry = mesh.geometry
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([expect.closeTo(40), expect.closeTo(1.8), expect.closeTo(0.7)]))
    mesh.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      }
    })
  })
})
