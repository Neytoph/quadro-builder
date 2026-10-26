import {readFileSync} from 'node:fs'
import {beforeAll,describe,expect,it} from 'vitest'
import * as THREE from 'three'
import {BuildModel,hingeDir} from './model.js'
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js'
import {resolveNodeConnection} from './bom.js'
import {parseQDF} from './qdfimport.js'
import {buildQDF} from './qdfexport.js'
import {SceneManager} from './scene.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'
import {Builder} from './builder.js'

beforeAll(()=>loadCatalog())
const options=()=>({tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})
function userModel(){
 const model=new BuildModel()
 expect(model.loadJSON(parseQDF(readFileSync('src/engine/fixtures/userRotatedCorner.qdf','utf8'),options())).ok).toBe(true)
 return model
}
function alignedElbow(model:BuildModel,id:string){
 const c=resolveNodeConnection(model,id)
 expect(c.type).toBe('elbow');expect(c.types).toEqual(['elbow']);expect(c.renderDirs).toHaveLength(2)
 expect(c.diagnostics).toEqual([])
 if(!c.renderDirs||!c.quat)throw new Error('missing connector pose')
 // 真实目录网格的两根插杆必须沿两根管，不能只核对BOM型号。
 for(const file of ['connectors.json','connectors-fine.json']){
  const raw=JSON.parse(readFileSync(`public/data/models/${file}`,'utf8'))
  const scene=Object.create(SceneManager.prototype)
  scene._keepGeos=new Set()
  scene._connMeshes=Object.fromEntries(Object.entries(raw).map(([key,value])=>{
   const r=value as {mask:number,pos:number[],nrm:number[],idx:number[]}
   return [key,{mask:r.mask,pos:Float32Array.from(r.pos,v=>v/100),nrm:Float32Array.from(r.nrm,v=>v/1000),idx:Uint16Array.from(r.idx)}]
  }))
  const q=new THREE.Quaternion(...c.quat).normalize()
  const mesh=scene._connMeshFor(c.renderDirs.map(d=>({d})),q,c.typeId)!
  const actual=[[1,0,0],[0,1,0]].map(d=>new THREE.Vector3(...d).applyQuaternion(mesh.quat))
  for(const d of c.worldDirs)expect(actual.some(a=>a.dot(new THREE.Vector3(...d))>.999)).toBe(true)
  for(const g of scene._keepGeos)g.dispose()
 }
}
function freshGate(fixedQuat=false){
 const model=new BuildModel(),a=model.addNode(0,80,0),pivot=model.addNode(0,60,0)
 model.addTube(a.id,pivot.id,'T15','green',15);model.addBolt(pivot.id);model.addHinge(pivot.id)
 model.rotateHingeBy(pivot.id,0,225)
 if(fixedQuat)pivot.quat=[0,0,0,1]
 const corner=model.extend(pivot.id,hingeDir(pivot,pivot.hinges![0]),'T25','red',25,30)!.node!
 model.extend(corner.id,[0,-1,0],'T35','green',35,40)
 return {model,pivot,corner}
}

describe('门扇直角接头随活动组保持实际朝向',()=>{
 it('用户实际QDF恢复缺失插口及失配朝向，管件、管长和全部节点位置保持',()=>{
  const raw=parseQDF(readFileSync('src/engine/fixtures/userRotatedCorner.qdf','utf8'),options()),model=userModel()
  expect(model.toJSON().tubes).toEqual(raw.tubes)
  expect([...model.nodes.values()].map(n=>[n.id,n.x,n.y,n.z])).toEqual(raw.nodes.map(n=>[n.id,n.x,n.y,n.z]))
  expect(model.nodes.get('n7')!.arms).toHaveLength(2)
  alignedElbow(model,'n7')
  const saved=model.toJSON();expect(model.loadJSON(saved).ok).toBe(true);expect(model.toJSON()).toEqual(saved)
 })
 it('固定栓继承的坐标不能覆盖活动铰链的实际接管方向',()=>{
  const {model,pivot,corner}=freshGate(true)
  alignedElbow(model,corner.id)
  for(const angle of [.1,10,45,80,-135]){
   expect(model.rotateJoint({kind:'hinge',nodeId:pivot.id,index:0},angle*Math.PI/180)).toBe(true)
   alignedElbow(model,corner.id)
  }
 })
 it.each(['drag','click'])('旧造型未保存接头坐标时，%s转动前先保留当前倾斜方向',motion=>{
  const {model,pivot,corner}=freshGate();delete corner.quat
  const before=model.toJSON(),lengths=before.tubes.map(t=>[t.id,t.length])
  expect(motion==='drag'?model.rotateJoint({kind:'hinge',nodeId:pivot.id,index:0},.2):model.rotateHingeBy(pivot.id,0,11)).toBe(true)
  alignedElbow(model,corner.id)
  expect(model.nodePos(pivot.id)).toEqual([0,60,0])
  expect(model.toJSON().tubes.map(t=>[t.id,t.length])).toEqual(lengths)
 })
 it('真实文件继续转动、撤销重做与官方QDF往返后保持两通直角件',()=>{
  const model=userModel(),builder=Object.create(Builder.prototype)
  Object.assign(builder,{model,scene:{},selection:new Map(),stepFrom:[],refresh:()=>{},onHistoryChange:()=>{},onPreview:()=>{}})
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  const fixed=[...model.nodes.values()].filter(n=>!['n7','n18'].includes(n.id)).map(n=>[n.id,...model.nodePos(n.id)])
  const before=model.toJSON()
  for(let i=0;i<36;i++){
   builder.recordHistory(()=>expect(model.rotateJoint({kind:'hinge',nodeId:'n15',index:0},Math.PI/18)).toBe(true))
   alignedElbow(model,'n7')
  }
  expect(fixed.map(([id])=>[id,...model.nodePos(id as string)])).toEqual(fixed)
  const after=model.toJSON();builder.history.undo();alignedElbow(model,'n7');builder.history.redo();expect(model.toJSON()).toEqual(after)
  const imported=new BuildModel();expect(imported.loadJSON(parseQDF(buildQDF(model).text,options())).ok).toBe(true)
  alignedElbow(imported,'n7')
  expect(before.nodes).toHaveLength(after.nodes.length)
 })
 it('保留手动型号、空插口和非直角连接的原始诊断',()=>{
  for(const mode of ['preferred','open-port','acute']){
   const {model,corner}=freshGate();corner.quat=[0,0,0,1]
   if(mode==='preferred')corner.preferType='4way'
   if(mode==='open-port')corner.arms=[[1,0,0],[0,1,0],[0,0,1]]
   if(mode==='acute'){const n=model.addNode(corner.x+20,corner.y+20,corner.z);model.addTube(corner.id,n.id,'T25','blue',25)}
   const saved=model.toJSON();expect(model.loadJSON(saved).ok).toBe(true)
   expect(model.toJSON()).toEqual(saved)
   expect(resolveNodeConnection(model,corner.id).canExport).toBe(false)
  }
 })
})
