import {mkdir,writeFile} from 'node:fs/promises'
import {Window} from 'happy-dom'
const base=process.env.BASE||'http://127.0.0.1:18637/'
Object.defineProperty(globalThis,'localStorage',{value:new Window({url:base}).localStorage,configurable:true})
const nativeFetch=globalThis.fetch.bind(globalThis)
globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>nativeFetch(new URL(String(input),base),init)) as typeof fetch
const {loadCatalog}=await import('../src/engine/catalog.js');await loadCatalog()
const {createDirectInstallationFrame}=await import('../src/engine/directInstallationExample.js')
await mkdir('public/examples/direct-install',{recursive:true})
const save=async(name:string,model:any)=>writeFile(`public/examples/direct-install/${name}.json`,JSON.stringify(model.toJSON(),null,2)+'\n')
await save('busy-adjacent-frame',createDirectInstallationFrame(80,40,{vertical:true}))
for(const [w,h] of [[40,40],[40,80],[80,40],[80,80]]){
  const model=createDirectInstallationFrame(w,h);await save(`trampoline-${w}x${h}-frame`,model)
  const candidate=model.confirmedMounts('trampoline').find((p:any)=>p.valid && p.params.width===w && p.params.height===h)
  if(!candidate || !model.addConfirmedComponent(candidate,'black'))throw new Error(`${w}×${h}实际蹦床安装失败`)
  await save(`trampoline-${w}x${h}`,model)
}
const adjacent=createDirectInstallationFrame(80,40,{vertical:true})
const left=adjacent.panelAccessoryMounts('panel_40x40_busy',{screwAxis:'vertical'}).find((p:any)=>p.pos[0]<40)
if(!left || !adjacent.addPanelAccessory(left,'green'))throw new Error('左忙碌板实际安装失败')
await save('busy-adjacent-left',adjacent)
const right=adjacent.panelAccessoryMounts('panel_40x40_busy',{screwAxis:'horizontal'}).find((p:any)=>p.pos[0]>40)
if(!right || !adjacent.addPanelAccessory(right,'green'))throw new Error('右忙碌板上下螺丝安装失败')
await save('busy-adjacent-installed',adjacent)
console.log('实际API完成两邻格忙碌板及4种蹦床尺寸的已安装/空框夹具')
