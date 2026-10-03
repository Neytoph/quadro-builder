import { mkdir, writeFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { CONFIRMED_COMPONENTS } from '../src/engine/componentPack.js'

const base=process.env.BASE||'http://127.0.0.1:18637/'
const browserEnvironment=new Window({url:base})
Object.defineProperty(globalThis,'localStorage',{value:browserEnvironment.localStorage,configurable:true})
const {loadCatalog}=await import('../src/engine/catalog.js')
const {createConfirmedComponentFixture,createConfirmedComponentGallery,createRetainedComponentFixture}=await import('../src/engine/confirmedComponentExample.js')
const realFetch=globalThis.fetch.bind(globalThis)
globalThis.fetch=((input: RequestInfo|URL,init?: RequestInit)=>realFetch(new URL(String(input),base),init)) as typeof fetch
await loadCatalog()
await mkdir('public/examples/confirmed-components',{recursive:true})
for(const spec of CONFIRMED_COMPONENTS) {
  for(const install of [true,false]) {
    const {model}=createConfirmedComponentFixture(spec.id,{install})
    await writeFile(`public/examples/confirmed-components/${spec.id}${install?'':'-frame'}.json`,JSON.stringify(model.toJSON(),null,2)+'\n')
  }
}
const {model,manifest}=createConfirmedComponentGallery()
await writeFile('public/examples/confirmed-components.json',JSON.stringify(model.toJSON(),null,2)+'\n')
await writeFile('public/examples/confirmed-components/manifest.json',JSON.stringify(manifest,null,2)+'\n')
const retained=[]
for(const id of ['wheel','swing','gym_rings','textile_rainbow','TA35','TA75','ocean_balls']){
  const model=createRetainedComponentFixture(id)
  await writeFile(`public/examples/confirmed-components/${id}.json`,JSON.stringify(model.toJSON(),null,2)+'\n')
  retained.push({partId:id,nodes:[...model.nodes.keys()],tubes:[...model.tubes.keys()],panels:[...model.panels.keys()],textiles:[...model.textiles.keys()],fittings:[...model.fittings.keys()]})
}
await writeFile('public/examples/confirmed-components/retained-manifest.json',JSON.stringify(retained,null,2)+'\n')
process.stdout.write(`真实API完成${CONFIRMED_COMPONENTS.length}类，${model.panels.size}板、${model.fittings.size}附属件；每类含已安装与空支撑框。\n`)
