import {beforeAll,describe,expect,it} from 'vitest'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {allTubes,loadCatalog} from './catalog.js'
import {CONFIRMED_COMPONENTS} from './componentPack.js'
import {isOuterScrewPanel} from './confirmedComponentModel.js'
import {componentMountsValid,componentFrame} from './accessoryPack.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'

beforeAll(loadCatalog)
const outer=CONFIRMED_COMPONENTS.filter(spec=>isOuterScrewPanel(spec.id))
// 使用真实目录管长和模型API建立隔离框架；动态JS引擎记录在断言处使用any。
function frame(spec:typeof outer[number],axis:string,split:number[],orientation:string){
  const model=new BuildModel(),edges:string[][]=[],nodes=new Map<string,any>()
  const world=([x,y]:number[])=>orientation==='horizontal'?[x,42.5,y]:orientation==='tilted'?[x,42.5+y*.6,y*.8]:[x,42.5+y,0]
  const node=(p:number[])=>{const key=p.join(',');if(!nodes.has(key))nodes.set(key,model.addNode(...world(p)));return nodes.get(key)}
  const corners=[[0,0],[spec.width,0],[spec.width,spec.height],[0,spec.height]]
  const selected=axis==='vertical'?[1,3]:[0,2]
  for(let edge=0;edge<4;edge++){
    edges.push([])
    if(!selected.includes(edge))continue
    const side=selected.indexOf(edge),count=split[side],a=corners[edge],b=corners[(edge+1)%4],span=Math.hypot(...b.map((v,i)=>v-a[i]))/count
    const part=allTubes().find((t:any)=>t.buildable&&t.shape==='straight'&&!t.id.startsWith('TA')&&Math.abs(t.length_cm+5-span)<.01)!
    if(!part)throw new Error(`目录没有${span-5}cm管`)
    for(let k=0;k<count;k++){
      const first=node(a.map((v,i)=>v+(b[i]-v)*k/count)),second=node(a.map((v,i)=>v+(b[i]-v)*(k+1)/count))
      const tube=model.addTube(first.id,second.id,part.id,'blue',part.length_cm)!
      expect(tube).toBeTruthy();edges[edge].push(tube.id)
    }
  }
  return {model,edges,selected}
}

describe('所有外扣螺丝板统一按连续固定边安装',()=>{
  for(const spec of outer)for(const orientation of spec.mountType==='horizontal-frame'?['horizontal']:['vertical','horizontal','tilted']){
    it.each(['vertical','horizontal'].flatMap(axis=>(axis==='vertical'&&spec.height<30?[[1,1]]:[[1,1],[1,2],[2,1],[2,2]]).map(split=>[axis,split] as const)))(`${spec.id} ${orientation} 固定%s，两边段数%s`,(axis,split)=>{
      const {model}=frame(spec,axis,[...split],orientation)
      const direct=model.confirmedMounts(spec.id).filter((p:any)=>p.valid)
      const automatic=model.panelAccessoryMounts(spec.id)
      const selected=model.panelAccessoryMounts(spec.id,{screwAxis:axis})
      expect(direct.length).toBeGreaterThan(0);expect(automatic.length).toBeGreaterThan(0);expect(selected.length).toBeGreaterThan(0)
      const part=model.addConfirmedComponent(selected[0],'blue') as any
      expect(part).toBeTruthy();expect(componentMountsValid(model,part)).toBe(true)
      expect(part.supportTubes).toHaveLength(split[0]+split[1]);expect(part.mounts).toHaveLength(4)
      expect(new Set(part.mounts.map((m:any)=>m.tube)).size).toBe(split[0]+split[1])
      expect(model.setPanelFixing(part.id,axis==='vertical'?'horizontal':'vertical')).toBe(false)
      const before=model.toJSON(),reopened=new BuildModel()
      expect(reopened.loadJSON(before).ok).toBe(true);expect(reopened.toJSON()).toEqual(before)
      expect(componentMountsValid(reopened,reopened.panels.get(part.id)!)).toBe(true)
      const selection=new Map([...model.nodes.keys()].map(id=>[id,'node']))
      expect(model.moveSelection(selection,160,0,0).ok).toBe(true)
      expect(componentMountsValid(model,model.panels.get(part.id)!)).toBe(true)
      const oldFrame=componentFrame(reopened,reopened.panels.get(part.id)!)!
      expect(componentFrame(model,model.panels.get(part.id)!)!.pos[0]).toBeCloseTo(oldFrame.pos[0]+160)
      reopened.removeTube(part.supportTubes.at(-1));expect(reopened.panels.size).toBe(0)
    })
  }

  it.each([[1,2],[2,1],[2,2]])('真实控制器先后点击两条固定边，段数%s/%s',(a,b)=>{
    const spec=outer.find(p=>p.id==='panel_40x40')!,{model,edges,selected}=frame(spec,'vertical',[a,b],'vertical')
    const history=new ModelHistory(docFromJSON(model.toJSON() as any)),builder=Object.create(Builder.prototype) as Builder
    Object.assign(builder,{model,history,selection:new Map(),mode:'panel',panelId:spec.id,color:'blue',scene:{cameraPosition:()=>[100,150,150],clearInstallationPreview:()=>{}},refresh:()=>{},onNotice:()=>{}})
    try{
      for(const reverse of [false,true]){
        const first=edges[selected[reverse?1:0]][0],second=edges[selected[reverse?0:1]].at(-1)!,rail=model._rail(first)!
        const partner=builder._freePartners(first,rail.len/2).find((p:any)=>p.id===second)
        expect(partner).toBeTruthy()
        const section=model.panelSection(partner,rail.len/2)
        builder._placePanelOnRails(first,second,section.t0,section.len)
        const part=[...model.panels.values()][0]
        expect(part).toBeTruthy();expect(componentMountsValid(model,part)).toBe(true)
        model.removePanel(part.id)
      }
    }finally{history.destroy()}
  })
})
