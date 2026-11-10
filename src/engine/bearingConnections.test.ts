import {beforeAll,describe,expect,it} from 'vitest'
import {BuildModel,hingeDir} from './model.js'
import {loadCatalog} from './catalog.js'
import {resolveNodeConnection,connectorFrameOf,computeBOM} from './bom.js'
import {buildQDF} from './qdfexport.js'
import {parseQDF} from './qdfimport.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'
import {Builder} from './builder.js'
import {BearingConnectionController} from './bearingConnectionController.js'
import {structuralBearingSupport} from './assemblyStructuralBearings.js'
import realDemo from './fixtures/userRainbowGate.json'

beforeAll(async()=>{await loadCatalog()})
function gate(){
 const model=new BuildModel(),a=model.addNode(0,0,0),b=model.addNode(0,40,0),pivot=model.addNode(0,60,0)
 const fixed=model.addTube(a.id,b.id,'T35','yellow',35)!
 model.addTube(b.id,pivot.id,'T15','blue',15);model.addBolt(pivot.id);model.addHinge(pivot.id)
 model.rotateHingeBy(pivot.id,0,90)
 const top=model.extend(pivot.id,hingeDir(pivot,90),'T25','green',25,30)!
 const right=model.extend(top.node!.id,[0,-1,0],'T35','blue',35,40)!
 const bottom=model.extend(right.node!.id,[-1,0,0],'T15','yellow',15,20)!
 return {model,fixed,pivot,end:bottom.node!,top:top.node!,right:right.node!}
}
describe('现有管端补装轴承',()=>{
 it('复用既有端头，补齐轴承和直通；管长、节点位置与原管数量不改变',()=>{
  const {model,fixed,end}=gate(),before=model.toJSON(),probe=model.bearingConnectionProbe(end.id,fixed.id,[0,21,2.45])
  if(!('center' in probe))throw new Error('missing bearing preview')
  expect(probe.valid).toBe(true);expect(probe.center).toEqual([0,20,0]);expect(probe.pos).toEqual([10,20,0])
  expect(model.toJSON()).toEqual(before)
  const installed=model.connectExistingBearing(end.id,fixed.id,probe.center)
  expect(installed.valid).toBe(true);expect(model.nodes.size).toBe(before.nodes.length)
  expect(model.toJSON().tubes).toEqual(before.tubes)
  for(const node of before.nodes)expect(model.nodePos(node.id)).toEqual([node.x,node.y,node.z])
  expect(model.fittings.size).toBe(1);expect(end.clampOn.tubeId).toBe(fixed.id)
  const bom=computeBOM(model)
  expect(bom.connectors.find(c=>c.type==='straight')?.count).toBe(2)
  expect(model.connectExistingBearing(end.id,fixed.id,[0,20,0]).valid).toBe(false)
 })
 it('用户真实演示的间距不匹配时明确拒绝，预览与提交均不改造型',()=>{
  const model=new BuildModel();model.loadJSON(realDemo)
  const before=model.toJSON(),probe=model.bearingConnectionProbe('n21','t12',[0,20,0])
  if(!('gapCm' in probe))throw new Error('missing bearing distance')
  expect(probe.valid).toBe(false);expect(probe.reason).toBe('distance');expect(probe.gapCm).toBeGreaterThan(9)
  expect(model.connectExistingBearing('n21','t12',[0,20,0]).valid).toBe(false);expect(model.toJSON()).toEqual(before)
 })
 it('阻止自连接、不同轴支撑及靠近接头的安装',()=>{
  const {model,end,right,fixed}=gate(),before=model.toJSON()
  const self=[...model.tubes.values()].find(t=>t.a===right.id&&t.tubeId==='T15')!
  expect(model.bearingConnectionProbe(end.id,self.id,[10,20,0]).valid).toBe(false)
  const a=model.addNode(0,0,5),b=model.addNode(0,40,5),wrong=model.addTube(a.id,b.id,'T35','red',35)!
  expect(model.bearingConnectionProbe(end.id,wrong.id,[0,20,5]).reason).toBe('axis')
  expect(model.bearingConnectionProbe(end.id,fixed.id,[0,0,0]).reason).toBe('tube_end')
  expect(model.toJSON().nodes.slice(0,before.nodes.length)).toEqual(before.nodes)
 })
 it('没有活动关节的刚体不能回接到自身承载管',()=>{
  const model=new BuildModel(),points=[[10,20,0],[30,20,0],[30,0,0],[0,0,0],[0,40,0]],nodes=points.map(p=>model.addNode(...p))
  for(let i=1;i<nodes.length;i++)model.addTube(nodes[i-1].id,nodes[i].id,'T35','yellow',35)
  const support=[...model.tubes.values()].at(-1)!
  expect(model.bearingConnectionProbe(nodes[0].id,support.id,[0,20,0]).reason).toBe('fixed')
 })
 it('上铰链和下轴承共轴，拖动任一活动端都只转动门扇',()=>{
  const {model,end,pivot,fixed}=gate();model.connectExistingBearing(end.id,fixed.id,[0,20,0])
  const fixedBefore=[model.nodePos(fixed.a),model.nodePos(fixed.b),model.nodePos(pivot.id)],before=model.toJSON()
  expect(model.rotationJoint({kind:'hinge',nodeId:pivot.id,index:0}).blocked).toBe(false)
  expect(model.rotateHingeBy(pivot.id,0,20)).toBe(true)
  expect(model.rotationJoint({kind:'tubeClamp',nodeId:end.id}).blocked).toBe(false)
  expect(model.rotateJoint({kind:'tubeClamp',nodeId:end.id},-Math.PI/9)).toBe(true)
  expect(pivot.hinges[0]).toBeCloseTo(130,2)
  expect([model.nodePos(fixed.a),model.nodePos(fixed.b),model.nodePos(pivot.id)]).toEqual(fixedBefore)
  for(const t of before.tubes){const current=model.tubes.get(t.id)!;expect(current.length).toBe(t.length)}
  expect([...model.collisions()]).toEqual([])
 })
 it('JSON、Yjs撤销重做与官方QDF往返仍保持连接和共轴转动',()=>{
  const {model,end,fixed,pivot}=gate(),builder=Object.create(Builder.prototype)
  builder.model=model;builder.refresh=()=>{};builder.onHistoryChange=()=>{};builder.onPreview=()=>{};builder.scene={};builder.selection=new Map();builder.stepFrom=[]
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  builder.recordHistory(()=>model.connectExistingBearing(end.id,fixed.id,[0,20,0]))
  const installed=model.toJSON();builder.history.undo();expect(model.fittings.size).toBe(0)
  builder.history.redo();expect(model.toJSON()).toEqual(installed)
  const reopened=new BuildModel();expect(reopened.loadJSON(installed).ok).toBe(true)
  expect(reopened.rotateHingeBy(pivot.id,0,12)).toBe(true)
  const imported=new BuildModel();expect(imported.loadJSON(parseQDF(buildQDF(model).text)).ok).toBe(true)
  const bolt=[...imported.nodes.values()].find(n=>n.hinges?.length)!,bearing=[...imported.nodes.values()].find(n=>n.bearingOn)!
  expect(bearing.clampOn).toBeTruthy();expect(imported.rotationJoint({kind:'hinge',nodeId:bolt.id,index:0}).blocked).toBe(false)
  expect(imported.rotateHingeBy(bolt.id,0,12)).toBe(true)
 })
})

describe('轴承座的穿管调整', () => {
 function axleFixture() {
  const model = new BuildModel()
  const left = model.addNode(0, 50, 0), right = model.addNode(40, 50, 0)
  model.addTube(left.id, right.id, 'T35', 'blue', 35)
  const bearings = [left, right].map(n => model.addBearingAtArm(n.id, [0, 1, 0])!)
  const a = model.addNode(-20, 60, 0), b = model.addNode(60, 60, 0)
  const shaft = model.addTube(a.id, b.id, 'T75', 'green', 75)!
  const spoke = model.addNode(60, 60, 20)
  model.addTube(b.id, spoke.id, 'T15', 'red', 15)
  model.noteBearingTube(left.id, shaft.id)
  return { model, left, right, bearings, a, b, shaft, spoke }
 }

 it('两座轴承共同限位，旧版近邻连线不带动支架，滑动后可正常导出并重开', () => {
  const { model, left, right, bearings, a, b, shaft, spoke } = axleFixture()
  model.addLink(left.id, a.id)
  const fixed = [left, right].map(n => model.nodePos(n.id))
  const fittingsBefore = model.toJSON().fittings
  expect([left.clampOn, right.clampOn]).toEqual([{ tubeId: shaft.id, t: 20 }, { tubeId: shaft.id, t: 60 }])
  expect(model.slideBearingShaft(left.id, 100)).toBe(true)
  expect(model.nodePos(a.id)).toEqual([-7.5, 60, 0])
  expect(model.slideBearingShaft(right.id, 5)).toBe(false)
  expect(model.slideBearingShaft(left.id, -100)).toBe(true)
  expect(model.nodePos(b.id)).toEqual([47.5, 60, 0])
  expect(model.nodePos(spoke.id)).toEqual([47.5, 60, 20])
  expect([left, right].map(n => model.nodePos(n.id))).toEqual(fixed)
  expect(model.toJSON().fittings).toEqual(fittingsBefore)
  expect(bearings.every(fitting => structuralBearingSupport(model, fitting).valid)).toBe(true)
  const imported = new BuildModel()
  expect(imported.loadJSON(parseQDF(buildQDF(model).text)).ok).toBe(true)
  const mounted = [...imported.nodes.values()].filter(n => n.bearingOn)
  expect(mounted).toHaveLength(2)
  expect(new Set(mounted.map(n => n.clampOn?.tubeId)).size).toBe(1)
  expect(imported.rotateJoint({ kind: 'bearingShaft', nodeId: mounted[0].id }, Math.PI / 3)).toBe(true)
 })

 it('绕管轴只转动活动侧，真实管件回接支架后拒绝调整', () => {
  const { model, left, bearings, a, b, spoke } = axleFixture()
  const ref = { kind: 'bearingShaft', nodeId: left.id }
  const fittingsBefore = model.toJSON().fittings
  expect(model.rotateJoint(ref, Math.PI / 2)).toBe(true)
  expect(model.nodePos(a.id)).toEqual([-20, 60, 0])
  expect(model.nodePos(b.id)).toEqual([60, 60, 0])
  expect(model.nodePos(spoke.id)).toEqual([60, 40, 0])
  expect(model.toJSON().fittings).toEqual(fittingsBefore)
  expect(bearings.every(fitting => structuralBearingSupport(model, fitting).valid)).toBe(true)
  model.addTube(left.id, spoke.id, 'T75', 'red', 75)
  const before = model.toJSON()
  expect(model.rotateJoint(ref, -Math.PI / 4)).toBe(false)
  expect(model.slideBearingShaft(left.id, 5)).toBe(false)
  expect(model.toJSON()).toEqual(before)
 })
})

// 隔离拾取输入，事务、模型、预览计算和撤销使用真实实现；浏览器交互另行验收。
function editor(touch=false){
 const state=gate(),builder=Object.create(Builder.prototype),frames:any[]=[]
 builder.model=state.model;builder.readOnly=false;builder.inputType=touch?'touch':'mouse';builder.onNotice=()=>{};builder.refresh=()=>{};builder.onHistoryChange=()=>{};builder.onPreview=()=>{};builder.stepFrom=[];builder.selection=new Map()
 builder.setHistory(new ModelHistory(docFromJSON(state.model.toJSON())))
 let target='end'
 builder.scene={pickHandle:()=>target==='end'?{data:{bearingEnd:state.end.id}}:null,pickForDelete:()=>null,pickTube:()=>target==='support'?{data:{id:state.fixed.id},point:{x:0,y:20,z:2.45}}:null,clearInstallationPreview:()=>{},showBearingConnectionPreview:(p:any)=>frames.push(p)}
 return {...state,builder,frames,controller:new BearingConnectionController(builder),target:(value:string)=>{target=value}}
}
describe('轴承两步连接控制',()=>{
 it('选择和悬停没有历史写入，确认只产生一条撤销',()=>{
  const {controller,builder,target,frames,model}=editor(),event={clientX:0,clientY:0},before=model.toJSON()
  expect(controller.click(event)).toBe(true);target('support');controller.hover(event)
  expect(frames.at(-1).valid).toBe(true);expect(model.toJSON()).toEqual(before);expect(builder.history.canUndo()).toBe(false)
  controller.click(event);expect(model.fittings.size).toBe(1);expect(controller.selected).toBeNull()
  builder.history.undo();expect(model.fittings.size).toBe(0);expect(builder.history.canUndo()).toBe(false)
 })
 it('触屏先显示预览，再次点同一位置才确认；可取消且只读无写入',()=>{
  const {controller,model,target,builder}=editor(true),event={clientX:0,clientY:0}
  controller.click(event);target('support');controller.hover(event);controller.click(event);expect(model.fittings.size).toBe(0)
  controller.click(event);expect(model.fittings.size).toBe(1)
  const other=editor();other.controller.click(event);other.controller.cancel();expect(other.model.fittings.size).toBe(0)
  builder.readOnly=true;expect(controller.click(event)).toBe(true);expect(model.fittings.size).toBe(1)
 })
})
describe('柔性铰链接管朝向',()=>{
 it('新端头继承实际铰链方向，后续管件跟随同一接头坐标',()=>{
  const {model,pivot}=gate();model.rotateHingeBy(pivot.id,0,2.82)
  const corner=[...model.nodes.values()].find(n=>n.x>29&&n.y===60)!
  expect(corner.quat).toBeTruthy();const frame=connectorFrameOf(model,corner)!
  const toward=hingeDir(pivot,pivot.hinges[0]);expect(Math.abs(frame[0].reduce((s:number,v:number,i:number)=>s+v*toward[i],0))).toBeGreaterThan(.99999)
 })
 it('用户原模型的小角度直角接头按真实管向恢复，不再按世界轴画插杆',()=>{
  const model=new BuildModel();model.loadJSON(realDemo)
  const connection=resolveNodeConnection(model,'n7');expect(connection.frame).toBeTruthy()
  const direction=connection.worldDirs[0],dot=Math.max(...connection.frame!.map(axis=>Math.abs(axis.reduce((s:number,v:number,i:number)=>s+v*direction[i],0))))
  expect(dot).toBeGreaterThan(.99999);expect(connection.diagnostics).toEqual([])
 })
})
