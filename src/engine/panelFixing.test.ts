import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { xAxisOf } from './util.js'
import { componentInstallCopy } from './accessoryInfo.js'
import { getLang, setLang } from './i18n.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { componentFrame, componentMountsValid, componentObstacle, componentVolumes, mountPoint } from './accessoryPack.js'
import { supportsPanelFixing, worldToLocal } from './confirmedComponentModel.js'
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'
import { panelLipProfiles, panelLipSegments, PANEL_LIP_CLEARANCE, PANEL_LIP_THICKNESS, PANEL_LIP_JOIN_DEPTH } from './panelScrewMounts.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })
// JavaScript引擎使用动态记录；any仅用于断言尚未建立TypeScript类型的模型字段。
const ids = CONFIRMED_COMPONENTS.filter(p => supportsPanelFixing(p.id)).map(p => p.id).concat('panel_40x40_busy')
function controller(model: BuildModel) {
  // 隔离控制器调度与真实Yjs历史；实际鼠标、界面及WebGL另行浏览器验收。
  const builder = Object.create(Builder.prototype), history = new ModelHistory(docFromJSON(model.toJSON() as any))
  Object.assign(builder, { model, history, selection: new Map(), mode: 'panel', color: 'blue', insetScrewAxis: 'vertical',
    scene: { cameraPosition: () => [100, 150, 150], clearInstallationPreview: () => {} }, refresh: () => {}, onNotice: () => {} })
  return builder as Builder
}

describe('板件实际固定对边', () => {
  it.each(ids.flatMap(id => [false, true].map(reverse => [id, reverse] as const)))('%s 点击两根对边管，反向=%s', (id, reverse) => {
    const model = id === 'panel_40x40_busy' ? createDirectInstallationFrame(80, 40, { vertical: true }) : createConfirmedComponentFixture(id, { install: false }).model
    const seed = model.panelAccessoryMounts(id).find((p: any) => p.valid) as any
    expect(seed).toBeTruthy()
    // 将同一真实框格的四条边逐一作为第一/第二根管，覆盖上下、左右及水平面。
    const corners = model.panelCorners(seed)!
    for (const edge of [0, 1]) {
      const ends = [edge, (edge + 2) % 4].map(i => [corners[i], corners[(i + 1) % 4]])
      const rails = ends.map(([a, b]) => [...model.tubes.values()].find(t => {
        const r = model._rail(t.id)
        return r && [a, b].every(p => {
          const along = p.reduce((n, v, i) => n + (v - r.p0[i]) * r.dir[i], 0)
          return Math.hypot(...p.map((v, i) => v - r.p0[i] - along * r.dir[i])) < .01
        })
      })!)
      expect(rails.every(Boolean)).toBe(true)
      if (reverse) rails.reverse()
      const builder = controller(model); builder.panelId = id
      const r = model._rail(rails[0].id)!
      const t0 = Math.min(...ends[reverse ? 1 : 0].map(p => p.reduce((n, v, i) => n + (v - r.p0[i]) * r.dir[i], 0)))
      const length = Math.hypot(...ends[0][0].map((v, i) => v - ends[0][1][i]))
      expect(builder._freePartners(rails[0].id, r.len / 2).some((p: any) => p.id === rails[1].id)).toBe(true)
      builder._placePanelOnRails(rails[0].id, rails[1].id, t0, length)
      const part = [...model.panels.values()][0] as any
      expect(part).toBeTruthy(); expect(part.mounts).toHaveLength(4)
      expect(part.mounts.every((m: any) => ends.some(([a, b]) => {
        const point = mountPoint(model, m)! as number[], direction = b.map((v, i) => (v - a[i]) / length)
        const along = point.reduce((n, v, i) => n + (v - a[i]) * direction[i], 0)
        return Math.hypot(...point.map((v, i) => v - a[i] - along * direction[i])) < .01
      }))).toBe(true)
      expect(componentMountsValid(model, part)).toBe(true)
      const reopened = new BuildModel(); expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(model.toJSON())
      builder.history.destroy(); model.removePanel(part.id)
    }
  })

  it.each(['panel_40x40', 'panel_40x40_lego', 'panel_40x40_busy', 'acrylic_panel_40x40'])('%s 选中修改保持板面位置、朝向并可撤销重做', id => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true }), seed = model.panelAccessoryMounts(id, { screwAxis: 'vertical', oppositeRetainers: true })[0]
    const part = model.addPanelAccessory(seed, 'blue') as any, builder = controller(model)
    expect(part).toBeTruthy(); builder.mode = 'select'; builder.selection.set(part.id, 'panel')
    const before = model.toJSON(), frame = componentFrame(model, part)!
    expect(builder.selectedPanelFixing()).toMatchObject({ partId: id, axis: 'vertical' })
    expect(builder.setSelectedPanelFixing('horizontal')).toBe(true)
    const after = componentFrame(model, part)!
    expect(after.pos).toEqual(frame.pos)
    after.axes.forEach((a, i) => a.forEach((v: number, k: number) => expect(v).toBeCloseTo(frame.axes[i][k])))
    expect(componentMountsValid(model, part)).toBe(true)
    expect(new Set(part.mounts.map((m: any) => mountPoint(model, m)![1]))).toEqual(new Set([42.5, 82.5]))
    const changed = model.toJSON(); builder.history.undo(); expect(builder.history.toJSON()).toEqual(before)
    builder.history.redo(); expect(builder.history.toJSON()).toEqual(changed)
    builder.readOnly = true; expect(builder.setSelectedPanelFixing('vertical')).toBe(false)
    builder.history.destroy()
  })

  it('自动安装绕开邻板固定点；手动切换碰撞保持原记录及历史', () => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    const left = model.panelAccessoryMounts('panel_40x40_busy', { screwAxis: 'vertical' }).find((p: any) => p.pos[0] < 40 && p.pos[1] > 60)!
    model.addPanelAccessory(left, 'blue')
    const right = model.panelAccessoryMounts('panel_40x40_busy', { screwAxis: 'auto' }).find((p: any) => p.pos[0] > 40 && p.pos[1] > 60) as any
    expect(right.params.screwAxis).toBe('horizontal')
    const part = model.addPanelAccessory(right, 'green') as any, builder = controller(model)
    builder.mode = 'select'; builder.selection.set(part.id, 'panel')
    const before = model.toJSON()
    expect(builder.setSelectedPanelFixing('vertical')).toBe(false)
    expect(model.toJSON()).toEqual(before); expect(builder.history.canUndo()).toBe(false)
    expect(componentObstacle(model, part)).toBeNull(); builder.history.destroy()
  })

  it.each(ids)('%s 切换固定边时保留水平/竖直/长方形板的完整姿态', id => {
    const model = id === 'panel_40x40_busy' ? createDirectInstallationFrame(80, 40, { vertical: true }) : createConfirmedComponentFixture(id, { install: false }).model
    const part = model.addPanelAccessory(model.panelAccessoryMounts(id, { screwAxis: 'vertical', oppositeRetainers: true })[0], 'blue') as any
    expect(part).toBeTruthy()
    const before = componentFrame(model, part)!, mounts = structuredClone(part.mounts)
    expect(model.setPanelFixing(part.id, 'horizontal')).toBe(true)
    const after = componentFrame(model, part)!
    expect(after.pos).toEqual(before.pos)
    after.axes.forEach((a, i) => a.forEach((v: number, k: number) => expect(v).toBeCloseTo(before.axes[i][k])))
    expect(componentMountsValid(model, part)).toBe(true)
    expect(part.mounts).not.toEqual(mounts)
    expect(model.setPanelFixing(part.id, 'vertical')).toBe(true)
    expect(part.mounts).toEqual(mounts)
  })

  it.each(['panel_40x40', 'panel_40x40_lego', 'acrylic_platform_40x40'])('%s 新固定位经过变换及复制仍对应实际管件', id => {
    const { model } = createConfirmedComponentFixture(id, { install: false })
    const part = model.addPanelAccessory(model.panelAccessoryMounts(id, { screwAxis: 'auto' })[0], 'blue') as any
    const selection = new Map([...model.nodes.keys()].map(node => [node, 'node']))
    expect(model.moveSelection(selection, 320, 0, 0).ok).toBe(true)
    expect(model.rotateSelection(selection).ok).toBe(true)
    expect(model.mirrorSelection(selection, 'z').ok).toBe(true)
    expect(componentMountsValid(model, model.panels.get(part.id)!)).toBe(true)
    const inserted = model.insertFragment(model.extractSelection(selection)!, [640, 2.5, 0]) as any
    const copied = model.panels.get(inserted.panels[0]) as any
    expect(componentMountsValid(model, copied)).toBe(true)
    expect(copied.mounts.every((m: any) => inserted.tubes.includes(m.tube))).toBe(true)
  })

  it('外扣板螺丝渲染与碰撞体均随固定边改变，非法轴拒绝', () => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    const part = model.addPanelAccessory(model.panelAccessoryMounts('panel_40x40_lego', { screwAxis: 'horizontal', oppositeRetainers: true })[0], 'green') as any
    const scene = { _materials: {}, _cachedGeo: (_: string, make: () => THREE.BufferGeometry) => make() }
    const meshes = confirmedComponentMeshes(scene, model, part)
    const heads = meshes.filter(m => m.name === 'panel-screw-head')
    expect(heads).toHaveLength(4)
    expect(meshes.filter(m => m.name.startsWith('panel-back-lip'))).toHaveLength(2)
    expect(meshes.some(m => m.name.startsWith('actual-retainer'))).toBe(false)
    const frame = componentFrame(model, part)!, volumes = componentVolumes(model, part)
    for (const head of heads) {
      expect((head.material as THREE.MeshPhysicalMaterial).color.getHexString()).toBe('252525')
      expect(head.geometry.type).toBe('CylinderGeometry')
      const point = worldToLocal(frame, head.position.toArray())
      expect(Math.abs(point[0]) + .6).toBeLessThan(18.5)
      expect(Math.abs(point[1]) + .6).toBeLessThan(18.5)
      expect(Math.abs(point[0])).toBeCloseTo(14)
      const radius=geometry().tubeRadius+PANEL_LIP_CLEARANCE+PANEL_LIP_THICKNESS
      const fromTube=[0,point[1]-Math.sign(point[1])*20,point[2]]
      expect(Math.hypot(...fromTube)).toBeCloseTo(radius-.035)
      const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion).toArray()
      expect(axis.reduce((sum, v, i) => sum + v * frame.axes[2][i], 0)).toBeCloseTo(.15/radius)
      expect(volumes.some(box => head.position.distanceTo(new THREE.Vector3(...box.pos)) < .01)).toBe(true)
    }
    const saved = model.toJSON(); expect(model.setPanelFixing(part.id, 'diagonal')).toBe(false); expect(model.toJSON()).toEqual(saved)
    expect(frame.pos[1]).toBe(62.5)
  })

  it.each(['panel_40x40','panel_40x20','hole_panel_40x40','panel_40x40_lego'])('%s 背面唇边不与板身正面重叠',id=>{
    const {model}=createConfirmedComponentFixture(id,{install:false})
    const part=model.addPanelAccessory(model.panelAccessoryMounts(id,{screwAxis:'horizontal',oppositeRetainers:true})[0],'blue') as any
    const front=2.51,back=front-geometry().panelThickness+PANEL_LIP_JOIN_DEPTH
    for(const lip of panelLipProfiles(part))expect(lip.sections.at(-1)!.outer[1]).toBeCloseTo(back)
    const cache={_materials:{},_cachedGeo:(_:string,make:()=>THREE.BufferGeometry)=>make()}
    const lips=confirmedComponentMeshes(cache,model,part).filter(m=>m.name.startsWith('panel-back-lip'))
    expect(lips).toHaveLength(2)
    for(const lip of lips){
      lip.geometry.computeBoundingBox()
      expect(worldToLocal(componentFrame(model,part)!,lip.position.toArray())[2]+lip.geometry.boundingBox!.max.z).toBeCloseTo(back)
    }
    expect(componentMountsValid(model,part)).toBe(true)
  })

  it.each(['panel_40x40','panel_40x20','hole_panel_40x40','panel_40x40_lego'].flatMap(id=>['vertical','horizontal'].map(axis=>[id,axis])))('%s %s弧形唇边贴合实际管径，碰撞分段保留管内空腔',(id,axis)=>{
    const {model}=createConfirmedComponentFixture(id,{install:false})
    const part=model.addPanelAccessory(model.panelAccessoryMounts(id,{screwAxis:axis,oppositeRetainers:true})[0],'blue') as any
    expect(part).toBeTruthy()
    const profiles=panelLipProfiles(part),segments=panelLipSegments(part)
    const inner=geometry().tubeRadius+PANEL_LIP_CLEARANCE,outer=inner+PANEL_LIP_THICKNESS
    for(const lip of profiles){
      for(const section of lip.sections.slice(0,33)){
        expect(Math.hypot(...section.inner)).toBeCloseTo(inner)
        expect(Math.hypot(...section.outer)).toBeCloseTo(outer)
      }
      const xs=lip.sections.map(s=>s.inner[0]);expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(.8)
    }
    for(const segment of segments){
      const lip=profiles.find(p=>p.origin.every((v:number,k:number)=>Math.abs(segment.point[k]-v)<4 || Math.abs(segment.axes[0][k])>0))!
      expect(lip).toBeTruthy()
      const delta=segment.point.map((v:number,k:number)=>v-lip.origin[k])
      const distance=Math.hypot(...segment.axes.slice(1).map((a:number[],i:number)=>Math.max(0,Math.abs(a.reduce((sum,v,k)=>sum+v*delta[k],0))-segment.half[i+1])))
      expect(distance).toBeGreaterThan(geometry().tubeRadius)
    }
    const cache={_materials:{},_cachedGeo:(_:string,make:()=>THREE.BufferGeometry)=>make()}
    const lips=confirmedComponentMeshes(cache,model,part).filter(m=>m.name.startsWith('panel-back-lip'))
    expect(lips).toHaveLength(2)
    for(const mesh of lips){
      expect(mesh.geometry.type).toBe('ExtrudeGeometry')
      const vertices=mesh.geometry.getAttribute('position'),frame=componentFrame(model,part)!
      for(let i=0;i<vertices.count;i++){
        const p=worldToLocal(frame,new THREE.Vector3().fromBufferAttribute(vertices,i).applyQuaternion(mesh.quaternion).add(mesh.position).toArray())
        expect(segments.some(s=>s.axes.every((a:number[],k:number)=>Math.abs(a.reduce((sum,v,j)=>sum+v*(p[j]-s.point[j]),0))<=s.half[k]+.001))).toBe(true)
      }
    }
    expect(componentMountsValid(model,part)).toBe(true)
    expect(componentObstacle(model,part)).toBeNull()
  })

  it.each(['vertical', 'horizontal'])('普通板%s固定的QDF安装方向与手册跟随实际螺丝', axis => {
    const model = createDirectInstallationFrame(80, 40, { vertical: true })
    const part = model.addPanelAccessory(model.panelAccessoryMounts('panel_40x40', { screwAxis: axis, oppositeRetainers: true })[0], 'blue') as any
    expect(part).toBeTruthy()
    const out = buildQDF(model), data = parseQDF(out.text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
    const parsed = data.panels![0] as any, rail = model._rail(part.mounts[0].tube)!, x = xAxisOf(parsed.geom.quat)
    expect(Math.abs(x.reduce((n: number, v: number, i: number) => n + v * rail.dir[i], 0))).toBeGreaterThan(.999)
    const language = getLang()
    try {
      for(const lang of ['zh','en','de'] as const){
        setLang(lang)
        const expected = { zh: ['左右','上下'], en: ['left and right','top and bottom'], de: ['linke und rechte','obere und untere'] }[lang][axis === 'vertical' ? 0 : 1]
        expect(componentInstallCopy(part.panelId, part).instructions[0]).toContain(expected)
        expect(componentInstallCopy(part.panelId, part).instructions[0]).not.toContain('固定角部')
      }
    } finally { setLang(language) }
  })
})
