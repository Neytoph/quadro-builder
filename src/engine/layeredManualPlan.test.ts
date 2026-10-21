import {readFileSync} from 'node:fs'
import {beforeAll,describe,it,expect} from 'vitest'
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js'
import {BuildModel} from './model.js'
import {parseQDF} from './qdfimport.js'
import {computeLayeredManualPlan,assemblyState} from './assemblyPlan.js'
import {coverItems} from './assemblyManual.js'
import {createAssemblyReadingPlan} from './assemblyReadingPlan.js'

beforeAll(async()=>{await loadCatalog()})
describe('分层说明书资料',()=>{
  it.each(['A0001','A0128','B0012','C0005','C0179'])('%s 无需连接或安装路径诊断，保留全部实体与材料用量',name=>{
    const model=new BuildModel(),data=parseQDF(readFileSync(`public/qdf/${name}.qdf`,'utf8'),{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})
    expect(model.loadJSON(data).ok).toBe(true)
    const before=JSON.stringify(model.toJSON()),plan=computeLayeredManualPlan(model)
    expect(plan.canExport).toBe(true)
    expect(plan.verification.pathChecked).toBe(false)
    expect(plan.verification.directionChecked).toBe(false)
    expect(plan.steps.every((step:any)=>!step.operations.length)).toBe(true)
    expect(plan.steps.map((step:any)=>step.y)).toEqual([...plan.steps.map((step:any)=>step.y)].sort((a:number,b:number)=>a-b))
    const allIds=['nodes','tubes','panels','clamps','textiles','slides','fittings'].flatMap(group=>[...(model as any)[group].keys()])
    const final=assemblyState(plan,plan.steps.length-1)
    expect([...final.visible].sort()).toEqual(allIds.sort())
    expect(plan.ledger.conserved).toBe(true)
    const reading=createAssemblyReadingPlan(model,plan,{items:coverItems(plan.bom),copy:{readingLayer:'{height} cm',readingBase:'底层'}})
    expect(reading.steps.flatMap((step:any)=>step.allocations).reduce((sum:number,row:any)=>sum+row.count,0)).toBe(plan.ledger.instances.reduce((sum:number,row:any)=>sum+row.count,0))
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })
  it.each(['s33','s36'])('%s 历史复杂造型也直接按高度分层',name=>{
    const model=new BuildModel();expect(model.loadJSON(JSON.parse(readFileSync(`tests/fixtures/assembly/${name}.json`,'utf8'))).ok).toBe(true)
    const plan=computeLayeredManualPlan(model)
    expect(plan.canExport).toBe(true)
    expect(plan.ledger.conserved).toBe(true)
    expect(plan.interfaces).toEqual([])
    expect(plan.steps.flatMap((step:any)=>step.operations)).toEqual([])
  })
})
