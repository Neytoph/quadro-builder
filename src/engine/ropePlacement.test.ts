import {beforeAll, describe, expect, it, vi} from 'vitest'
import {Object3D} from 'three'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {loadCatalog} from './catalog.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// JS控制器运行时附加交互字段，夹具用any调用真实原型；模型、诊断和Yjs历史均为真实实现。
// 射线适配仅用于检查控制器，不代表浏览器验收。
function fixture() {
  const model = new BuildModel()
  const beam = (y: number) => {
    const a = model.addNode(0,y,0), b = model.addNode(80,y,0)
    return model.addTube(a.id,b.id,'T75','blue',75)!
  }
  const upper = beam(100), lower = beam(40)
  let hit: any = null, handle: any = null
  const markers: any[] = []
  const scene = {
    cameraPosition: () => [40,80,200],
    pickTube: () => hit,
    pickHandle: () => handle,
    addHandle: (position: number[], data: any, kind: string) => {
      const mesh = new Object3D()
      mesh.position.fromArray(position); mesh.userData = data
      markers.push({mesh, data, kind})
      return mesh
    },
    moveHandle: (mesh: Object3D, position: number[]) => mesh.position.fromArray(position),
    setHandleVisible: (mesh: Object3D, visible: boolean) => { mesh.visible = visible },
    showInstallationPreview: vi.fn(), clearInstallationPreview: vi.fn(),
  }
  const builder: any = Object.create(Builder.prototype)
  Object.assign(builder, {model, scene, mode:'fitting', fittingKind:'rope', fittingPart:'rope',
    color:'blue', selection:new Map(), stepFrom:[], onNotice:vi.fn(), onHistoryChange:vi.fn(), onChange:vi.fn(),
    refresh: () => {markers.length = 0; builder._tubeHandles = new Map(); builder._buildFittingHandles()},
  })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  builder.refresh()
  const point = (tube: any, x: number, y: number) => { hit = {data:{kind:'tube',id:tube.id},point:{x,y,z:1.7}}; handle = null }
  const click = () => builder._clickFitting({clientX:123,clientY:456})
  return {model,builder,scene,upper,lower,markers,point,click,setHandle:(value:any) => {handle=value;hit=null}}
}

describe('绳索沿管连续定位', () => {
  it('只显示每根管的定位点，保持任意小数位置，离开后回到建议位置', () => {
    const f = fixture(), {builder,upper,point,markers} = f
    expect(markers).toHaveLength(2)
    for (const x of [18.37,18.58,13.41]) {
      point(upper,x,102); builder._trackTubeHandles(123,456)
      const marker = builder._tubeHandles.get(upper.id)
      expect(marker.mesh.position.toArray()).toEqual([x,100,0])
      expect(marker.mesh.userData.ropeMount.t).toBeCloseTo(x/80,10)
    }
    f.setHandle(null); builder._trackTubeHandles(123,456)
    expect(builder._tubeHandles.get(upper.id).mesh.position.x).toBe(40)
    expect(builder._tubeHandles.get(upper.id).mesh.userData.ropeMount.t).toBe(0.5)
  })

  it('第一端固定显示，第二端预览不写模型；第二次点击安装一次，撤销重做和重开保持位置', () => {
    const {model,builder,upper,lower,point,click,markers,scene} = fixture()
    const before = model.toJSON()
    point(upper,18.37,102); click()
    expect(builder._ropeFirst).toEqual({tube:upper.id,t:18.37/80})
    expect(markers.find(marker => marker.data.ropeFirst)?.mesh.position.toArray()).toEqual([18.37,100,0])
    point(lower,49.81,42); builder._trackTubeHandles(123,456)
    builder._showRopeHover(builder._ropePointerMount(123,456).mount)
    expect(scene.showInstallationPreview).toHaveBeenLastCalledWith(model,expect.objectContaining({kind:'rope',valid:true}),true)
    expect(model.toJSON()).toEqual(before)
    builder._showRopeHover(null)
    expect(scene.clearInstallationPreview).toHaveBeenCalled()
    expect(builder._ropeFirst).toEqual({tube:upper.id,t:18.37/80})
    click()
    const rope: any = [...model.fittings.values()][0]
    expect(rope.mounts.map((mount:any) => [mount.tube,mount.t])).toEqual([[upper.id,18.37/80],[lower.id,49.81/80]])
    expect(model.confirmedDiagnostics(rope).valid).toBe(true)
    expect(builder._ropeFirst).toBeNull()
    const after = JSON.parse(JSON.stringify(model.toJSON()))
    builder.history.undo(); expect(model.toJSON()).toEqual(before)
    builder.history.redo(); expect(model.toJSON()).toEqual(after)
    const reopen = new BuildModel(); expect(reopen.loadJSON(after).ok).toBe(true)
    expect(reopen.toJSON()).toEqual(after)
    expect(builder.history.canUndo()).toBe(true)
    builder.history.undo(); expect(builder.history.canUndo()).toBe(false)
  })

  it('触屏未悬停也按本次点击位置定位，允许直接点绿色标记', () => {
    const f = fixture()
    f.point(f.upper,17.89,100); f.click()
    const marker = f.builder._tubeHandles.get(f.lower.id)
    f.setHandle({data:marker.mesh.userData,object:marker.mesh}); f.click()
    const rope: any = [...f.model.fittings.values()][0]
    expect(rope.mounts[0].t).toBeCloseTo(17.89/80,10)
    expect(rope.mounts[1].t).toBe(0.5)
  })

  it('无效第二端保留第一端，调整后可以继续安装', () => {
    const f = fixture(), {model,builder,upper,lower,point,click} = f
    point(upper,18.37,100); click()
    for (const id of [lower.a,lower.b]) model.nodes.get(id)!.y = -200
    point(lower,30,-200); click()
    expect(model.fittings.size).toBe(0)
    expect(builder._ropeFirst).toEqual({tube:upper.id,t:18.37/80})
    expect(builder.onNotice).toHaveBeenLastCalledWith(expect.any(String),'warn')
    for (const id of [lower.a,lower.b]) model.nodes.get(id)!.y = 40
    point(lower,31.63,40); click()
    expect(model.fittings.size).toBe(1)
  })

  it('点击第一端标记或Esc取消不写入历史，之后能重新选择', () => {
    const f = fixture(), {builder,upper,point,click} = f
    point(upper,18.37,100); click()
    f.setHandle({data:{ropeFirst:true}}); click()
    expect(builder._ropeFirst).toBeNull()
    point(upper,21.43,100); click()
    expect(builder.clearMarks()).toBe(true)
    expect(builder._ropeFirst).toBeNull()
    expect(builder.installationPreview).toBeNull()
    expect(builder.history.canUndo()).toBe(false)
  })

  it('原管重选位置、两端范围和只读状态保持', () => {
    const {model,builder,upper,point,click} = fixture()
    expect(builder._ropeMountAt(upper.id,{x:-10,y:100,z:0}).t).toBe(0.05)
    expect(builder._ropeMountAt(upper.id,{x:100,y:100,z:0}).t).toBe(0.95)
    point(upper,18.37,100); click()
    point(upper,21.43,100); click()
    expect(builder._ropeFirst.t).toBeCloseTo(21.43/80,10)
    builder.readOnly = true
    point(upper,30,100); click()
    expect(builder._ropeFirst.t).toBeCloseTo(21.43/80,10)
    expect(model.fittings.size).toBe(0)
  })

  it('第一端承载管被移除后刷新清除过期选择和提示', () => {
    const {model,builder,upper,point,click} = fixture()
    point(upper,18.37,100); click()
    model.removeTube(upper.id); builder.refresh()
    expect(builder._ropeFirst).toBeNull()
    expect(builder.installationPreview).toBeNull()
    expect(model.fittings.size).toBe(0)
  })

  it.each([[[0,1,0]],[[Math.SQRT1_2,Math.SQRT1_2,0]]])('竖管及斜管按轴投影，无固定步长：%j', axis => {
    const f = fixture(), a = f.model.nodes.get(f.upper.a)!, b = f.model.nodes.get(f.upper.b)!
    Object.assign(a,{x:0,y:50,z:0}); Object.assign(b,{x:axis[0]*80,y:50+axis[1]*80,z:0})
    const at = 21.37, mount = f.builder._ropeMountAt(f.upper.id,{x:axis[0]*at,y:50+axis[1]*at,z:2})
    expect(mount.t).toBeCloseTo(at/80,10)
    expect(mount.pos[0]).toBeCloseTo(axis[0]*at,10)
    expect(mount.pos[1]).toBeCloseTo(50+axis[1]*at,10)
  })
})
