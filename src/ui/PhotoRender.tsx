import {useEffect,useRef,useState} from 'react'
import {useEngine} from '../store/EngineContext'
import {useCollab} from '../collab/CollabContext'
import {useI18n} from '../i18n'
import {useDock} from './dock'
import {photoWords,photoStyles,photoCall,presetFrame,resizePhotoFrame,openPhotoHistory} from '../../public/photo-render.js'

export const OPEN_PHOTO='quadro:photo-render'
export function openPhotoRender(){window.dispatchEvent(new Event(OPEN_PHOTO))}
type Rect={x:number;y:number;width:number;height:number;outputWidth:number;outputHeight:number}
export default function PhotoRender(){
 const api=useEngine(),collab=useCollab(),{lang}=useI18n(),t=photoWords(lang)
 const {setPane}=useDock()
 const [open,setOpen]=useState(false),[rect,setRect]=useState<Rect|null>(null),[viewport,setViewport]=useState({left:0,top:0,width:1,height:1}),[preset,setPreset]=useState('4:3'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[description,setDescription]=useState(''),[capture,setCapture]=useState<{id:string;source:string;url:string}|null>(null),[owner,setOwner]=useState('')
 const preview=useRef<HTMLDialogElement>(null),live=useRef({api,collab}),drag=useRef<{rect:Rect;handle:string;x:number;y:number}|null>(null),generation=useRef(0),activeTab=useRef(api.activeTabId)
 live.current={api,collab}
 useEffect(()=>()=>{generation.current++},[])
 useEffect(()=>{
  if(!open)return
  const engine=api.engine();if(!engine)return
  engine.builder.setReadOnly(true)
  return()=>{engine.builder.setReadOnly(live.current.api.readOnly)}
 },[open,api.activeTabId])
 useEffect(()=>{
  if(!open)return
  let disposed=false
  setBusy(true)
  void(async()=>{
   try{const account=await identity();if(disposed)return
    const pending=localStorage.getItem('xmf-photo-submit:'+account)
    if(pending){const saved=JSON.parse(pending);setDescription(saved.prompt||'')
     try{await photoCall('/attempts',account,'POST',{quoteId:saved.quote.id,requestId:saved.requestId});localStorage.removeItem('xmf-photo-submit:'+account);if(!disposed){setOpen(false);await openPhotoHistory({source:saved.quote.source,owner:account,lang})}}
     catch(cause){if((cause as {code?:string}).code==='render_conflict')localStorage.removeItem('xmf-photo-submit:'+account);throw cause}
    }
   }catch(cause){if(!disposed)fail(cause)}finally{if(!disposed)setBusy(false)}
  })()
  return()=>{disposed=true}
 },[open])
 useEffect(()=>{photoStyles();const show=()=>{setPane(null);setOpen(true);setCapture(null);setPreset('4:3');setError('')};window.addEventListener(OPEN_PHOTO,show);return()=>window.removeEventListener(OPEN_PHOTO,show)},[])
 useEffect(()=>{if(activeTab.current!==api.activeTabId){activeTab.current=api.activeTabId;generation.current++;setOpen(false);setCapture(null);setDescription('')}},[api.activeTabId])
 useEffect(()=>{
  if(!open)return
  const invalid=()=>{generation.current++;setOpen(false);setCapture(null);setDescription('');setOwner('')};window.addEventListener('quadro-account-invalidated',invalid)
  const canvas=api.engine()?.scene.renderer.domElement as HTMLCanvasElement|undefined;if(!canvas)return
  const resize=()=>{const bounds=canvas.getBoundingClientRect();setViewport({left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height});setRect(presetFrame(bounds));setPreset('4:3')}
  resize();const observer=new ResizeObserver(resize);observer.observe(canvas);window.addEventListener('resize',resize)
  return()=>{observer.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('quadro-account-invalidated',invalid)}
 },[open,api.activeTabId])
 useEffect(()=>{if(capture)preview.current?.showModal()},[capture])
 const fail=(cause:unknown)=>{const code=cause instanceof Error?cause.message:'error';setError(t[code as keyof typeof t]||t.error)}
 async function identity(){const token=generation.current,response=await fetch('/quadro/identity',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error('account_changed');const id=String((await response.json()).userId);if(token===generation.current)setOwner(id);return id}
 async function source(){
  const {api,collab}=live.current;if(api.readOnly)throw new Error('render_forbidden')
  if(collab.mode==='plan'){if(!collab.canEdit||!collab.session?.synced)throw new Error('render_forbidden');await collab.session.exportNow();return 'plan:'+collab.session.plan.id}
  const saved=await api.saveCurrent();if(!saved)throw new Error('error');
  const tab=live.current.api.tabs.find(row=>row.tabId===live.current.api.activeTabId)
  return tab?.libraryId||'model:'+saved.docId
 }
 async function take(){if(!rect)return;setBusy(true);setError('');const token=++generation.current
  try{
   const account=await identity();if(token!==generation.current)return;const reference=await source();if(token!==generation.current)return
   const scene=api.engine()?.scene;if(!scene)throw new Error('error');const camera=scene.camera
   const result=await photoCall('/captures',account,'POST',{source:reference,camera:{...scene.cameraState(),up:camera.up.toArray(),fov:camera.fov||45,left:camera.left||0,right:camera.right||0,top:camera.top||0,bottom:camera.bottom||0},viewport:{width:viewport.width,height:viewport.height},frame:{x:rect.x/viewport.width,y:rect.y/viewport.height,width:rect.width/viewport.width,height:rect.height/viewport.height},background:scene._sceneOn?'grass':scene._homeGroup&&!scene._homeHidden?'home':'blank',width:rect.outputWidth,height:rect.outputHeight})
   if(token===generation.current)setCapture(result)
  }catch(cause){if(token===generation.current)fail(cause)}finally{if(token===generation.current)setBusy(false)}
 }
 async function history(){const token=generation.current;setBusy(true);setError('');try{const account=await identity();if(token!==generation.current)return;const reference=await source();if(token===generation.current)await openPhotoHistory({source:reference,owner:account,lang})}catch(cause){if(token===generation.current)fail(cause)}finally{if(token===generation.current)setBusy(false)}}
 async function generate(){if(!capture||!description.trim())return;const token=generation.current;setBusy(true);setError('');const key='xmf-photo-submit:'+owner
  try{
   const pending=localStorage.getItem(key),saved=pending?JSON.parse(pending):null
   if(saved&&(saved.capture!==capture.id||saved.prompt!==description)){
    await photoCall('/attempts',owner,'POST',{quoteId:saved.quote.id,requestId:saved.requestId});localStorage.removeItem(key)
    if(token===generation.current){preview.current?.close();setCapture(null);setOpen(false);await openPhotoHistory({source:saved.quote.source,owner,lang})}return
   }
   const quote=saved?.capture===capture.id&&saved?.prompt===description?saved.quote:await photoCall('/quotes',owner,'POST',{capture:capture.id,prompt:description,language:lang})
   const requestId=saved?.quote?.id===quote.id?saved.requestId:crypto.randomUUID().replaceAll('-','')
   localStorage.setItem(key,JSON.stringify({quote,requestId,capture:capture.id,prompt:description}))
   await photoCall('/attempts',owner,'POST',{quoteId:quote.id,requestId});localStorage.removeItem(key)
   if(token===generation.current){preview.current?.close();setCapture(null);setOpen(false);await openPhotoHistory({source:capture.source,owner,lang})}
  }catch(cause){if(token===generation.current)fail(cause)}finally{if(token===generation.current)setBusy(false)}
 }
 if(!open)return null
 return <>
  {!capture&&rect&&<div className="photo-overlay" style={{left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height}}>
   <div className="photo-frame" style={{left:rect.x,top:rect.y,width:rect.width,height:rect.height}}>{['nw','n','ne','e','se','s','sw','w'].map(handle=><button type="button" key={handle} className="photo-handle" data-handle={handle} aria-label={t.resize+' '+handle} disabled={busy}
    onPointerDown={event=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);drag.current={rect,handle,x:event.clientX,y:event.clientY}}}
    onPointerMove={event=>{if(!drag.current)return;const d=drag.current,next=resizePhotoFrame(d.rect,d.handle,event.clientX-d.x,event.clientY-d.y,viewport);setRect(next);if(Math.abs(next.width/next.height-rect.width/rect.height)>1e-7)setPreset('')}}
    onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}}
    onKeyDown={event=>{const delta={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[event.key];if(delta){event.preventDefault();setRect(resizePhotoFrame(rect,handle,delta[0],delta[1],viewport));setPreset('')}}}/> )}</div>
   {(error||busy)&&<p role={error?'alert':'status'} className="photo-status">{error||t.preparing}</p>}
   <div className="photo-toolbar"><div className="photo-ratios" role="group" aria-label={t.resize}>{[['3:4',3/4],['4:3',4/3],['16:9',16/9],['9:16',9/16]].map(([label,ratio])=><button type="button" key={label} aria-pressed={preset===label} disabled={busy} onClick={()=>{setPreset(String(label));setRect(presetFrame(viewport,Number(ratio)))}}>{label}</button>)}</div><button type="button" className="qb-btn qb-btn-ghost" onClick={()=>void history()} disabled={busy}>{t.history}</button><button type="button" className="qb-btn" onClick={()=>void take()} disabled={busy}>{t.take}</button><button type="button" className="photo-close" disabled={busy} onClick={()=>setOpen(false)}>{t.close}</button></div>
  </div>}
  {capture&&<dialog ref={preview} className="photo-dialog" onCancel={event=>{if(busy)event.preventDefault();else setCapture(null)}}><header><h2>{t.title}</h2><button type="button" className="photo-close" disabled={busy} onClick={()=>{preview.current?.close();setCapture(null);setOpen(false)}}>{t.close}</button></header><div className="photo-preview-content"><img src={capture.url+'?u='+owner} alt={t.take}/><label htmlFor="photo-description">{t.prompt}</label><textarea id="photo-description" value={description} maxLength={1500} placeholder={t.description} disabled={busy} onChange={event=>setDescription(event.target.value)}/>{error&&<p role="alert" className="photo-error">{error}</p>}<div className="photo-preview-actions"><button type="button" className="qb-btn qb-btn-ghost" disabled={busy} onClick={()=>{preview.current?.close();setCapture(null)}}>{t.retake}</button><button type="button" className="qb-btn" disabled={busy||!description.trim()} aria-busy={busy} onClick={()=>void generate()}>{t.generate}</button></div></div></dialog>}
 </>
}
