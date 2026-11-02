import {beforeAll,describe,expect,it} from 'vitest'
import * as THREE from 'three'
import {SceneManager} from './scene.js'
import {BuildModel} from './model.js'
import {loadCatalog} from './catalog.js'

beforeAll(async()=>{await loadCatalog()})

describe('连续定位预览资源',()=>{
  it.each(['rope','gym_rings'])('%s 每轮预览释放临时几何和材质，绳长不进入永久缓存',kind=>{
    const model=new BuildModel(),a=model.addNode(0,100,0),b=model.addNode(80,100,0),c=model.addNode(0,40,20),d=model.addNode(80,40,20)
    const top=model.addTube(a.id,b.id,'T75','red',75)!,bottom=model.addTube(c.id,d.id,'T75','blue',75)!
    // 使用真实Three.js对象验证释放事件，不创建WebGL或冒充实际浏览器验收。
    const scene=Object.create(SceneManager.prototype),cached=new Map()
    Object.assign(scene,{scene:new THREE.Scene(),_materials:{},requestRender:()=>{},_cachedGeo:(key:string,create:()=>THREE.BufferGeometry)=>{
      if(!cached.has(key))cached.set(key,create());return cached.get(key)
    }})
    let allocated=0,disposedGeometry=0,disposedMaterial=0
    for(let i=0;i<12;i++){
      const part=kind==='rope' ? model.ropeDiagnostics({tube:top.id,t:0.2+i/100},{tube:bottom.id,t:0.7})
        : model.accessoryDiagnostics('gym_rings',top.id,{position:[18+i,100,0]})
      expect(part.valid).toBe(true)
      scene.showInstallationPreview(model,part,true)
      scene._installationGroup.traverse((object:THREE.Mesh)=>{
        if(!object.geometry)return
        allocated++
        object.geometry.addEventListener('dispose',()=>disposedGeometry++)
        ;(object.material as THREE.Material).addEventListener('dispose',()=>disposedMaterial++)
      })
    }
    scene.clearInstallationPreview()
    expect(disposedGeometry).toBe(allocated)
    expect(disposedMaterial).toBe(allocated)
    expect(cached.size).toBe(0)
    expect(scene.scene.children).toHaveLength(0)
  })
})
