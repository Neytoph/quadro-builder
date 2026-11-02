import {RESOURCE_MODE} from './entry'

let delivered=false
export function resourceFileDelivered(){return delivered}
export function sendResourceMessage(message:Record<string,unknown>){
  if(RESOURCE_MODE&&parent!==window)parent.postMessage(message,location.origin)
}
export function deliverResourceFile(blob:Blob,name:string){
  delivered=true
  if(RESOURCE_MODE&&parent!==window){
    parent.postMessage({type:'xmf-resource:file',blob,name},location.origin)
    return
  }
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download=name;link.click()
  setTimeout(()=>URL.revokeObjectURL(url),10000)
}
