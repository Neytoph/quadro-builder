import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { resolveNodeConnection } from './bom.js'
import { SceneManager } from './scene.js'

beforeAll(() => loadCatalog())

function corner(directions: number[][]) {
  const model = new BuildModel()
  const node = model.addNode(0, 80, 0)
  for (const d of directions) {
    const end = model.addNode(d[0] * 40, 80 + d[1] * 40, d[2] * 40)
    model.addTube(node.id, end.id, 'T35', 'yellow', 35)
  }
  return { model, node }
}

describe('斜管交接处的普通接头插口', () => {
  for (const angle of [30, 45, 60]) {
    it(`${angle}度斜管不增加斜插杆或改变原有三通，安装诊断保持`, () => {
      const a = angle * Math.PI / 180
      const { model, node } = corner([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -Math.sin(a), Math.cos(a)]])
      const before = model.toJSON()
      const connection = resolveNodeConnection(model, node)
      expect(connection.frame).toBeNull()
      expect(connection.type).toBe('3way')
      expect(connection.types).toEqual(['3way'])
      expect(connection.renderDirs).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
      expect(connection.worldDirs).toHaveLength(4)
      expect(connection.canExport).toBe(false)
      expect(connection.diagnostics.map(d => d.code)).toContain(angle === 45 ? 'MISSING_C45_ADAPTER' : 'UNSUPPORTED_CONNECTOR_ANGLE')
      expect(model.toJSON()).toEqual(before)
      const reopened = new BuildModel()
      expect(reopened.loadJSON(before).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(before)
      expect(resolveNodeConnection(reopened, node.id).renderDirs).toEqual(connection.renderDirs)
    })
  }

  it('仅一个有效轴向管口时，不凭斜管补出普通连接件', () => {
    const { model, node } = corner([[0, 1, 0], [0, -1, 1]])
    const connection = resolveNodeConnection(model, node)
    expect(connection.type).toBe('end')
    expect(connection.types).toEqual([])
    expect(connection.renderDirs).toEqual([[0, 1, 0]])
    expect(connection.canExport).toBe(false)
  })

  it('整体倾斜的直角框架保留自身正交插口和朝向', () => {
    const { model, node } = corner([[1, 0, 0], [0, 1, 1], [0, -1, 1]])
    const connection = resolveNodeConnection(model, node)
    expect(connection.frame).not.toBeNull()
    expect(connection.renderDirs).toEqual(connection.worldDirs)
    expect(connection.types).toEqual(['3way'])
    expect(connection.diagnostics).toEqual([])
  })

  it('已有手动通型与旧45度件标记保持', () => {
    const { model, node } = corner([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 1]])
    node.preferType = '4way'
    const manual = model.toJSON()
    expect(resolveNodeConnection(model, node).types).toEqual(['4way'])
    expect(model.toJSON()).toEqual(manual)
    delete node.preferType
    node.c45 = true
    const legacy = model.toJSON()
    const adapter = resolveNodeConnection(model, node)
    expect(adapter.types).toEqual(['3way', 'diagonal'])
    expect(adapter.renderDirs).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    expect(model.toJSON()).toEqual(legacy)
  })

  for (const file of ['connectors.json', 'connectors-fine.json']) {
    it(`${file} 使用真实三通网格，插杆均沿横平竖直方向`, () => {
      const { model, node } = corner([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 1]])
      const connection = resolveNodeConnection(model, node)
      const dirs = connection.renderDirs
      if (!dirs) throw new Error('缺少接头显示方向')
      const raw = JSON.parse(readFileSync('public/data/models/' + file, 'utf8'))
      const scene = Object.create(SceneManager.prototype)
      scene._keepGeos = new Set()
      scene._connMeshes = Object.fromEntries(Object.entries(raw).map(([key, value]) => {
        const mesh = value as { mask: number; pos: number[]; nrm: number[]; idx: number[] }
        return [key, { mask: mesh.mask, pos: Float32Array.from(mesh.pos, v => v / 100), nrm: Float32Array.from(mesh.nrm, v => v / 1000), idx: Uint16Array.from(mesh.idx) }]
      }))
      const mesh = scene._connMeshFor(dirs.map(d => ({ d })), new THREE.Quaternion(), connection.typeId)
      expect(mesh).not.toBeNull()
      const inverse = mesh.quat.clone().invert()
      for (const d of dirs) {
        const local = new THREE.Vector3(...d).applyQuaternion(inverse)
        expect(Math.max(...local.toArray().map(Math.abs))).toBeCloseTo(1)
      }
      for (const geometry of scene._keepGeos) geometry.dispose()
    })
  }
})
