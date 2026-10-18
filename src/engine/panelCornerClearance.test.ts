import {beforeAll,describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {Euler,Vector3} from 'three'
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js'
import {BuildModel} from './model.js'
import {parseQDF} from './qdfimport.js'
import {confirmedPanelDiagnostics,confirmedFrame,localToWorld} from './confirmedComponentModel.js'
import {componentObstacle,componentVolumes} from './accessoryPack.js'
import {CONFIRMED_COMPONENTS} from './componentPack.js'
import {createConfirmedComponentFixture} from './confirmedComponentExample.js'
import {hasInsetScrews} from './insetPanelMounts.js'

beforeAll(loadCatalog)
const outerPanels=CONFIRMED_COMPONENTS.filter(p=>p.placement==='panel'&&!hasInsetScrews({panelId:p.id,params:p})&&!['basin','sensory'].includes(p.feature))

function official() {
  const model=new BuildModel(),text=readFileSync('public/qdf/A0118.qdf','utf8')
  expect(model.loadJSON(parseQDF(text,{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})).ok).toBe(true)
  return model
}

describe('板角接头让位与真实障碍',()=>{
  it.each([0,Math.PI/4,Math.PI/2])('真实标准管框架倾斜%f弧度后，角部两侧延伸管仍可让位', angle=>{
    const model=new BuildModel(),rotation=new Euler(angle,Math.PI/6,0),at=(x:number,y:number,z:number)=>new Vector3(x,y,z).applyEuler(rotation).add(new Vector3(0,100,0)).toArray()
    const points=[[0,0,0],[40,0,0],[40,40,0],[0,40,0]],nodes=points.map(p=>{const q=at(p[0],p[1],p[2]);return model.addNode(q[0],q[1],q[2])})
    const edges=nodes.map((node,i)=>model.addTube(node.id,nodes[(i+1)%4].id,'T35','blue',35)!)
    for(let i=0;i<4;i++)for(const sign of [-1,1]){const p=points[i],q=at(p[0],p[1],40*sign),end=model.addNode(q[0],q[1],q[2]);expect(model.addTube(nodes[i].id,end.id,'T35','green',35)).toBeTruthy()}
    for(const side of [-1,1])for(const screwAxis of ['vertical','horizontal']){
      const result=model.panelAccessoryDiagnostics({a:edges[0].id,b:edges[2].id,t0:0,len:40,panelId:'panel_40x40',side,params:{screwAxis}})
      expect(result.valid,JSON.stringify({angle,side,screwAxis,reason:result.reason,obstacle:result.obstacle})).toBe(true)
    }
  })

  it.each(outerPanels.flatMap(p=>['vertical','horizontal'].map(axis=>[p.id,axis])))('%s %s保留角部两侧延伸管的安装空间', (id,axis)=>{
    const {model,candidate}=createConfirmedComponentFixture(id,{install:false})
    const probe={...candidate,params:{...candidate.params,screwAxis:axis}},frame=confirmedFrame(model,probe)!
    const corners=model.panelCorners(probe)!
    const node=(p:number[])=>model.addNode(p[0],p[1],p[2])
    for(const point of corners)for(const sign of [-1,1]){
      const a=node(point)
      const end=point.map((v:number,i:number)=>v+frame.axes[2][i]*40*sign),b=node(end)
      if(![...model.tubes.values()].some(t=>t.a===a.id&&t.b===b.id||t.a===b.id&&t.b===a.id))expect(model.addTube(a.id,b.id,'T35','green',35)).toBeTruthy()
    }
    for(const side of [-1,1]){
      const result=model.panelAccessoryDiagnostics({...probe,side})
      expect(result.valid,JSON.stringify({id,axis,side,reason:result.reason,obstacle:result.obstacle})).toBe(true)
    }
    const saved=model.toJSON(),part=model.addPanelAccessory(probe,'blue')!
    expect(part).toBeTruthy();expect(model.panelAccessoryMounts(id,{screwAxis:'auto',oppositeRetainers:true}).some(p=>Math.hypot(...p.pos.map((v:number,i:number)=>v-candidate.pos[i]))<.01)).toBe(false)
    expect(model.loadJSON(saved).ok).toBe(true);expect(model.panelAccessoryDiagnostics(probe).valid).toBe(true)
  })

  it('Mega Fortress 原始空框可装普通板，保存重开及删除后诊断一致',()=>{
    const model=official(),probe={a:'t107',b:'t111',t0:0,len:40,panelId:'panel_40x40',side:1,params:{screwAxis:'horizontal'}}
    expect(confirmedPanelDiagnostics(model,probe).valid).toBe(true)
    expect(model.panelAccessoryDiagnostics(probe).valid).toBe(true)
    const part=model.addPanelAccessory(probe,'yellow')!;expect(part).toBeTruthy();expect(model.panels.size).toBe(9)
    const reopened=new BuildModel();expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(reopened.panelAccessoryDiagnostics({...part,id:part.id}).valid).toBe(true)
    reopened.removePanel(part.id);expect(reopened.panelAccessoryDiagnostics(probe).valid).toBe(true)
  })

  it.each([[0,0],[19.7,0],[17.8,17.8],[20,17.2]])('角部及板身真正侵入仍拦截：%j', (x,y)=>{
    const {model,candidate}=createConfirmedComponentFixture('panel_40x40',{install:false}),probe={...candidate,params:{...candidate.params,screwAxis:'horizontal'}},frame=confirmedFrame(model,probe)!
    const a=model.addNode(...localToWorld(frame,[x,y,-10]) as [number,number,number]),b=model.addNode(...localToWorld(frame,[x,y,10]) as [number,number,number])
    const tube=model.addTube(a.id,b.id,'T15','red',15)!
    expect(componentObstacle(model,confirmedPanelDiagnostics(model,probe))).toEqual({kind:'tube',id:tube.id})
  })

  it('保守碰撞几何仍覆盖圆角边缘的实际板身',()=>{
    const {model,candidate}=createConfirmedComponentFixture('panel_40x40',{install:false}),frame=confirmedFrame(model,candidate)!,boxes=componentVolumes(model,candidate).filter(b=>b.roundTubeClearance)
    // 用圆形让位的真实轮廓取样，验证细分没有通过缩小板身来放行。
    for(const sx of [-1,1])for(const sy of [-1,1])for(let k=0;k<=360;k++){
      const angle=k*Math.PI/720,r=2.51+.00001,p=localToWorld(frame,[sx*(20-r*Math.cos(angle)),sy*(20-r*Math.sin(angle)),2.36])
      expect(boxes.some(box=>box.axes.every((axis:number[],i:number)=>Math.abs(axis.reduce((sum,v,j)=>sum+v*(p[j]-box.pos[j]),0))<=box.half[i]+.000001))).toBe(true)
    }
  })
})
