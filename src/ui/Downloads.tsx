import {useEffect,useRef,useState} from 'react'
import {useEngine} from '../store/EngineContext'
import {useI18n} from '../i18n'
import {labelOf,colorLabel} from '../names'
import {partImageSrc} from './partImages'
import {RESOURCE_MODE,bootEntry} from '../entry'
import {bomSections} from './bomExport'

export const OPEN_DOWNLOADS='quadro:downloads'
let inlineManualViews=0
export function hasInlineManualProgress(){return inlineManualViews>0}
const words={zh:['下载资料','正在读取造型资料…','关闭'],en:['Download files','Loading model information…','Close'],de:['Dateien herunterladen','Modellinformationen werden geladen…','Schließen']}
export function openDownloads(){window.dispatchEvent(new Event(OPEN_DOWNLOADS))}
export async function exportResource(api:ReturnType<typeof useEngine>,action:string){
  if(api.readOnly)throw new Error('423')
  if(RESOURCE_MODE){
    const source=bootEntry().src,owner=new URLSearchParams(location.search).get('resourceOwner')
    if(source){const response=await fetch(source,{credentials:'same-origin',cache:'no-store',headers:owner?{'X-Builder-User-ID':owner}:{}});if(!response.ok)throw new Error('Download HTTP '+response.status);await response.body?.cancel()}
  }
  if(action==='manual'){
    const result=await api.exportAssemblyPdf()
    if(result?.status==='failed')throw new Error(result.message)
    return {cancelled:!result||result.status==='cancelled'}
  }
  else if(action==='picture')await api.exportPng()
  else if(action==='json')api.exportJson()
  else if(action==='qdf')api.exportQdf()
}
type Widget={destroy:()=>void;update:(value:unknown)=>void}
type ResourceStock={data:Record<string,Record<string,number>>;rev:number}
async function readResourceStock(signal?:AbortSignal):Promise<ResourceStock>{
  const owner=new URLSearchParams(location.search).get('resourceOwner')
  const response=await fetch('/quadro/inventory',{credentials:'same-origin',cache:'no-store',headers:owner?{'X-Builder-User-ID':owner}:{},signal})
  if(!response.ok)throw new Error('Inventory HTTP '+response.status)
  const result=await response.json() as ResourceStock
  if(result.data===null||typeof result.data!=='object'||Array.isArray(result.data))throw new Error('Invalid inventory data')
  for(const group of ['tubes','connectors','panels','fittings','reinforcements']){
    const values=result.data[group];if(values===undefined)continue
    if(values===null||typeof values!=='object'||Array.isArray(values)||Object.values(values).some(value=>!Number.isInteger(value)||value<0))throw new Error('Invalid inventory quantity')
  }
  return result
}
export function DownloadContents(){
  const api=useEngine(),{lang,t}=useI18n(),root=useRef<HTMLDivElement>(null),live=useRef(api),widget=useRef<Widget|null>(null),[error,setError]=useState('');live.current=api
  const [remote,setRemote]=useState<ResourceStock|null>(null)
  const checked=RESOURCE_MODE?!!remote?.rev:api.feasible!==null
  const bomRows=api.bom?bomSections(api.bom,t).flatMap(section=>section.rows):[]
  const rows=api.invRows.map(row=>{const owned=checked?(RESOURCE_MODE?remote?.data[row.group]?.[row.key]||0:row.owned):null;const variants=bomRows.filter(part=>part.id===row.key).map(part=>({need:part.count,label:[part.color?colorLabel(part.color):'',part.w&&part.h?`${part.w}×${part.h} cm`:''].filter(Boolean).join(' · ')}));return {group:row.group,id:row.key,need:row.need,owned,short:owned===null?null:Math.max(0,row.need-owned),soft:row.soft,variants,label:labelOf(row.key,row.name),image:partImageSrc(row.key,false)}})
  const stockState=RESOURCE_MODE&&error?'error':checked?'ready':RESOURCE_MODE&&!remote?'loading':'empty'
  const latestStock=useRef(stockState);latestStock.current=stockState
  useEffect(()=>{
    if(!RESOURCE_MODE)return
    const controller=new AbortController()
    void readResourceStock(controller.signal).then(setRemote).catch(error=>{if(!controller.signal.aborted)setError(String(error))})
    return()=>controller.abort()
  },[])
  const latestRows=useRef(rows);latestRows.current=rows
  useEffect(()=>{inlineManualViews++;return()=>{inlineManualViews--;live.current.cancelManualExport()}},[])
  useEffect(()=>{
    let cancelled=false;const url=import.meta.env.BASE_URL+'model-resources.js?v=20261020';
    void import(/* @vite-ignore */ url).then(module=>{
      if(cancelled||!root.current)return
      const current=live.current
      widget.current=module.mountResources(root.current,{name:current.tabs.find(tab=>tab.tabId===current.activeTabId)?.name||'',lang,source:RESOURCE_MODE?'saved':'current',rows:latestRows.current,stockState:latestStock.current,canNative:!current.readOnly,
        onCancel:()=>live.current.cancelManualExport(),onExport:(action:string)=>exportResource(live.current,action)}) as Widget
    }).catch(error=>{if(!cancelled)setError(String(error))})
    return()=>{cancelled=true;widget.current?.destroy();widget.current=null}
  },[lang,api.activeTabId])
  useEffect(()=>{widget.current?.update({rows,stockState})},[api.tick,api.feasible,api.inventory,api.invRows,remote,stockState])
  useEffect(()=>{widget.current?.update({manualProgress:api.exportingManual})},[api.exportingManual])
  return <>{error&&<p role="alert">{error}</p>}<div ref={root}/></>
}
export default function Downloads(){
  const {lang}=useI18n(),api=useEngine(),dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false),previous=useRef<Element|null>(null)
  useEffect(()=>{const show=()=>{previous.current=document.activeElement;setOpen(true)};window.addEventListener(OPEN_DOWNLOADS,show);return()=>window.removeEventListener(OPEN_DOWNLOADS,show)},[])
  useEffect(()=>{if(open)dialog.current?.showModal()},[open])
  if(!open)return null
  const close=()=>{if(api.exportingManual){api.cancelManualExport();return}dialog.current?.close();setOpen(false);if(previous.current instanceof HTMLElement)previous.current.focus({preventScroll:true})}
  return <dialog ref={dialog} className="mr-root-dialog" onCancel={event=>{event.preventDefault();close()}} onClick={event=>{if(event.target===dialog.current){const box=dialog.current.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close()}}}>
    <header className="mr-dialog-header"><h2>{words[lang][0]}</h2><button type="button" onClick={close} disabled={!!api.exportingManual} aria-label={words[lang][2]}>×</button></header>
    <div className="mr-dialog-body"><DownloadContents/></div>
  </dialog>
}
