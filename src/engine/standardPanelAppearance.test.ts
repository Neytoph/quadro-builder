import {beforeAll,describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {loadCatalog} from './catalog.js'
import {SceneManager} from './scene.js'
import {BuildModel} from './model.js'
import {confirmedSpec} from './componentPack.js'
import {confirmedFrame,worldToLocal} from './confirmedComponentModel.js'
import {confirmedComponentMeshes} from './confirmedComponentMeshes.js'
import {createConfirmedComponentFixture} from './confirmedComponentExample.js'

beforeAll(async()=>{await loadCatalog()})
// 读取真实工厂网格并执行生产几何方法；不创建GPU，不代替浏览器画面验收。
function scene(native:boolean) {
  const value=Object.create(SceneManager.prototype)
  Object.assign(value,{_materials:{},_fitGeos:new Map(),_keepGeos:new Set(),_panelGeos:new Map(),_quality:'high',_look:(color:string)=>color==='blue'?'#2b8ff0':color})
  value._q=()=>({meshes:native,notch:16})
  if(native) {
    const raw=JSON.parse(readFileSync('public/data/models/surfaces.json','utf8'))
    value._surfMeshes=Object.fromEntries(Object.entries(raw).map(([key,record])=>{
      const v=record as {pos:number[],nrm:number[],idx:number[]}
      return [key,{pos:new Float32Array(v.pos.map(n=>n/100)),nrm:new Float32Array(v.nrm.map(n=>n/1000)),idx:new Uint16Array(v.idx)}]
    }))
  }
  return value
}
describe('标准板外形与塑料材质',()=>{
  for(const native of [true,false])it.each(['panel_40x40','panel_40x20','panel_30x30','hole_panel_40x40'])('%s 外边接到框格管轴，顶面位于管顶 '+(native?'工厂网格':'加载前'),id=>{
    const {model,part}=createConfirmedComponentFixture(id),frame=confirmedFrame(model,part)!,spec=confirmedSpec(id)!,saved=model.toJSON()
    const mesh=confirmedComponentMeshes(scene(native),model,part).find(m=>m.name.startsWith('plate:'))!,positions=mesh.geometry.getAttribute('position')
    mesh.updateMatrix()
    const box=new THREE.Box3()
    for(let i=0;i<positions.count;i++)box.expandByPoint(new THREE.Vector3(...worldToLocal(frame,new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrix).toArray())))
    expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(spec.width,3)
    expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(spec.height,3)
    expect(box.max.z).toBeCloseTo(2.51,3)
    const material=mesh.material as THREE.MeshStandardMaterial
    expect(material.metalness).toBe(0);expect(material.shadowSide).toBe(THREE.BackSide)
    expect(model.toJSON()).toEqual(saved)
    const reopened=new BuildModel();expect(reopened.loadJSON(saved).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(saved)
  })
  it('矩形普通板翻面和转向保持完整框格外宽',()=>{
    const {model,part}=createConfirmedComponentFixture('panel_40x20'),value=scene(true)
    for(const side of [1,-1])for(const turned of [false,true]){
      Object.assign(part!,{side,turned})
      const frame=confirmedFrame(model,part)!,mesh=confirmedComponentMeshes(value,model,part).find(m=>m.name.startsWith('plate:'))!
      const p=mesh.geometry.getAttribute('position');mesh.updateMatrix()
      const box=new THREE.Box3()
      for(let i=0;i<p.count;i++)box.expandByPoint(new THREE.Vector3(...worldToLocal(frame,new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrix).toArray())))
      expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(40,3);expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(20,3)
    }
  })
})
