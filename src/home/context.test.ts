import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Vector3 } from 'three'
import { loadCatalog } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { docFromJSON, docToJSON, type ModelJSON } from '../collab/ymodel'
import { productOnly } from '../share'
import { placeInRoom, validHomeContext } from './context.js'
import { createHomeEnvironment, disposeHome } from './environment.js'

// 隔离坐标夹具，用于验证存档契约；真实模型与浏览器验收另有运行证据。
const room = () => ({ id: 'private-room', rev: 4, name: '自定义房间', data: { mode: 'area', room: { w: 450, h: 260, d: 350 }, items: [{ id: 'green', name: '搭建区', type: 'usable', kind: 'usable', x: 135, elevation: 0, z: 85, w: 125, h: 260, d: 125 }] } })
const home = () => placeInRoom(room(), { min: [40, 0, 80], max: [85, 85, 165] })
beforeAll(() => loadCatalog())

describe('房间与原生模型的存档关系', () => {
  it('普通模型首次按真实外轮廓居中并落地', () => {
    expect(home().placement).toEqual({ position: [225, 0, 175], pivot: [62.5, 0, 122.5], rotation: 0 })
  })
  it('拒绝重复区域、离地搭建区和房间外的体积', () => {
    expect(validHomeContext(home())).toBe(true)
    const duplicate = home(); duplicate.snapshot.items.push(structuredClone(duplicate.snapshot.items[0]))
    expect(validHomeContext(duplicate)).toBe(false)
    const elevated = home(); elevated.snapshot.items[0].elevation = 1
    expect(validHomeContext(elevated)).toBe(false)
    const outside = home(); outside.snapshot.items[0].x = 440
    expect(validHomeContext(outside)).toBe(false)
    const unknown = home(); unknown.snapshot.items[0].kind = unknown.snapshot.items[0].type = 'toString'
    expect(validHomeContext(unknown)).toBe(false)
  })
  it('原生 JSON 与跨文档 Yjs 更新保留完整快照及旋转', () => {
    const model = new BuildModel(); model.addNode(40, 0, 80)
    const context = home(); context.placement.rotation = 90
    expect(model.loadJSON({ ...model.toJSON(), homeContext: context }).ok).toBe(true)
    const first = docFromJSON(model.toJSON() as ModelJSON), second = new Y.Doc()
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))
    expect(docToJSON(second).homeContext).toEqual(context)
    const copy = new BuildModel(); expect(copy.loadJSON(docToJSON(second)).ok).toBe(true)
    expect(copy.toJSON()).toEqual(model.toJSON()); first.destroy(); second.destroy()
  })
  it('坏房间数据不会替换当前产品', () => {
    const model = new BuildModel(); model.addNode(40, 0, 80); const before = model.toJSON()
    expect(model.loadJSON({ ...before, homeContext: { version: 99 } }).ok).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })
  it('环境逆变换保持房间坐标中的产品相对位置', () => {
    const context = home(); context.placement.rotation = 90
    const environment = createHomeEnvironment(context), native = new Vector3(42, 30, 100)
    const expected = native.clone().sub(new Vector3(...context.placement.pivot)).applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).add(new Vector3(...context.placement.position))
    expect(environment.worldToLocal(native.clone()).distanceTo(expected)).toBeLessThan(1e-8)
    disposeHome(environment)
  })
  it('公开产品输出移除房间且不改动原始私有存档', () => {
    const model = { nodes: [{ id: 'n1', x: 40, y: 0, z: 80 }], homeContext: home() }
    expect(productOnly(model)).toEqual({ nodes: model.nodes }); expect(model.homeContext).toEqual(home())
  })
})
