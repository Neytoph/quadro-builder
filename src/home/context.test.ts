import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Box3, HemisphereLight, LineSegments, Matrix4, Mesh, Object3D, Vector3 } from 'three'
import { loadCatalog } from '../engine/catalog.js'
import { BuildModel } from '../engine/model.js'
import { docFromJSON, docToJSON, type ModelJSON } from '../collab/ymodel'
import { productOnly } from '../share'
import { placeInRoom, validHomeContext } from './context.js'
import { createHomeEnvironment, disposeHome, setHomeZonesVisible } from './environment.js'

// 隔离坐标夹具，用于验证存档契约；真实模型与浏览器验收另有运行证据。
const room = () => ({ id: 'private-room', rev: 4, name: '自定义房间', data: { mode: 'area', room: { w: 450, h: 260, d: 350 }, items: [{ id: 'green', name: '搭建区', type: 'usable', kind: 'usable', x: 135, elevation: 0, z: 85, w: 125, h: 260, d: 125 }] } })
const home = () => placeInRoom(room(), { min: [40, 0, 80], max: [85, 85, 165] })
beforeAll(() => loadCatalog())

describe('房间与原生模型的存档关系', () => {
  it('切换辅助区域时保留柱子，坐标、房间快照与产品存档保持一致', () => {
    const context = home(); context.placement.rotation = 90
    context.snapshot.items.push({ id: 'column', name: '柱子', type: 'column', kind: 'furniture', x: 20, elevation: 0, z: 20, w: 40, h: 260, d: 40 })
    context.snapshot.items.push({ id: 'clearance', name: '留空', type: 'reserved', kind: 'reserved', x: 80, elevation: 35, z: 25, w: 20, h: 80, d: 100 })
    const model = new BuildModel(); model.addNode(40, 0, 80)
    expect(model.loadJSON({ ...model.toJSON(), homeContext: context }).ok).toBe(true)
    const saved = model.toJSON(), environment = createHomeEnvironment(context)
    const objects = environment.children.filter(o => o.userData.homeItemId)
    const matrices = objects.map(o => o.matrixWorld.toArray())
    const shell = environment.children.find(o => !o.userData.homeItemId)!
    setHomeZonesVisible(environment, { obstacles: false, usable: true })
    expect(objects.filter(o => o.visible).map(o => o.userData.homeItemId)).toEqual(['green', 'column'])
    expect(shell.visible).toBe(true)
    setHomeZonesVisible(environment, { obstacles: true, usable: false })
    expect(objects.filter(o => o.visible).map(o => o.userData.homeItemId)).toEqual(['column', 'clearance'])
    setHomeZonesVisible(environment, { obstacles: false, usable: false })
    expect(objects.filter(o => o.visible).map(o => o.userData.homeItemId)).toEqual(['column'])
    setHomeZonesVisible(environment, { obstacles: true, usable: true })
    expect(objects.every(o => o.visible)).toBe(true)
    environment.updateMatrixWorld(true)
    expect(objects.map(o => o.matrixWorld.toArray())).toEqual(matrices)
    expect(model.toJSON()).toEqual(saved)
    disposeHome(environment)
  })
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
  it('房间中的窗户和门洞随模型保存，并参与三维房间绘制', () => {
    const context = home()
    const openings = [{ id: 'window', kind: 'window', wall: 'back', offset: 40, width: 100, height: 100, elevation: 80 }, { id: 'door', kind: 'door', wall: 'left', offset: 50, width: 90, height: 200, elevation: 0 }]
    Object.assign(context.snapshot, { openings })
    expect(validHomeContext(context)).toBe(true)
    const model = new BuildModel(); model.addNode(40, 0, 80)
    expect(model.loadJSON({ ...model.toJSON(), homeContext: context }).ok).toBe(true)
    expect(model.toJSON().homeContext.snapshot.openings).toEqual(openings)
    Object.assign(context.snapshot, { openings: [openings[0], { ...openings[1], wall: 'back', offset: 50 }] })
    expect(validHomeContext(context)).toBe(true)
    const environment = createHomeEnvironment(context), shell = environment.children.find((o: Object3D) => o.name === 'home-room-shell')!
    expect(shell.children.filter((o: Object3D) => o.userData.wall).length).toBe(4)
    disposeHome(environment)
    Object.assign(context.snapshot, { openings: [{ ...openings[0], elevation: 200 }] })
    expect(validHomeContext(context)).toBe(false)
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
  it('旋转后的家具、搭建区与地面格子仍使用房间厘米坐标', () => {
    const context = home(); context.placement.rotation = 90
    context.snapshot.items.push({ id: 'cabinet', name: '柜子', type: 'cabinet', kind: 'furniture', x: 20, elevation: 15, z: 20, w: 140, h: 180, d: 45 })
    const environment = createHomeEnvironment(context), inverse = environment.matrixWorld.clone().invert()
    for (const item of context.snapshot.items) {
      const object = environment.children.find(o => o.userData.homeItemId === item.id)!, box = new Box3()
      object.traverse(o => {
        if (!(o instanceof Mesh)) return
        o.geometry.computeBoundingBox()
        box.union(o.geometry.boundingBox!.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, o.matrixWorld)))
      })
      const dimensions = box.getSize(new Vector3()).toArray()
      dimensions.forEach((n, a) => expect(n).toBeCloseTo([item.w, item.h, item.d][a], 4))
      box.min.toArray().forEach((n, a) => expect(n).toBeCloseTo([item.x, item.elevation, item.z][a], 4))
    }
    const grid = environment.getObjectByName('home-floor-grid') as LineSegments, points = grid.geometry.attributes.position
    expect(points.getX(2) - points.getX(0)).toBe(25)
    expect(environment.getWorldScale(new Vector3()).toArray()).toEqual([1, 1, 1])
    let skyDirection: Vector3 | undefined
    environment.traverse(o => { if (o instanceof HemisphereLight) skyDirection = o.getWorldPosition(new Vector3()) })
    expect(skyDirection!.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-8)
    disposeHome(environment)
  })
})
