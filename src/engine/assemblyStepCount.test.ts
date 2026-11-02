import {beforeAll,describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js'
import {BuildModel} from './model.js'
import {parseQDF} from './qdfimport.js'
import {computeAssemblyPlan,computeAssemblyStepCount} from './assemblyPlan.js'

beforeAll(async()=>{await loadCatalog()})

function load(file:string){
 const model=new BuildModel()
 const data=file.endsWith('.qdf')?parseQDF(readFileSync('public/qdf/'+file,'utf8'),{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2}):JSON.parse(readFileSync('tests/fixtures/assembly/'+file,'utf8'))
 expect(model.loadJSON(data).ok).toBe(true)
 return model
}
describe('精确步骤计数',()=>{
 it.each(['A0001.qdf','A0016.qdf','A0128.qdf','B0012.qdf','C0005.qdf','C0013.qdf','C0156.qdf','C0179.qdf','s33.json','s36.json'])('%s 与完整动作验证计数相同，模型不变且完整计划保留台账',file=>{
  const model=load(file),original=JSON.stringify(model.toJSON())
  const full=computeAssemblyPlan(model),count=computeAssemblyStepCount(model)
  expect(typeof count).toBe('number')
  expect(count).toBe(full.steps.length)
  expect(full.ledger).not.toBeNull()
  expect(full.bom).not.toBeNull()
  expect(JSON.stringify(model.toJSON())).toBe(original)
 },120000)

 it.each(['x+','x-','z+','z-'])('%s 顺序按相同规则计数，重新编辑后重新计算',order=>{
  const model=load('A0001.qdf')
  expect(computeAssemblyStepCount(model,order)).toBe(computeAssemblyPlan(model,{},order).steps.length)
  const first=[...model.tubes.keys()][0];model.removeTube(first)
  expect(computeAssemblyStepCount(model,order)).toBe(computeAssemblyPlan(model,{},order).steps.length)
 },120000)
})
