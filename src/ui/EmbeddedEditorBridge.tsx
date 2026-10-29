import {useEffect,useRef} from 'react'
import {useEngine} from '../store/EngineContext'
import {useCollab} from '../collab/CollabContext'
import {EDITOR_EMBED,bootEntry} from '../entry'
import {storage} from '../engine-api'
import {modelContent} from '../store/personalTabs'
import {useI18n} from '../i18n'
import {isUntitledName} from '../names'

/** 父页面负责外壳和关闭确认，实际保存与协作仍由编辑器完成。 */
export default function EmbeddedEditorBridge(){
 const api=useEngine(),collab=useCollab(),{t}=useI18n(),live=useRef({api,collab,t}),announced=useRef(false),working=useRef(false)
 live.current={api,collab,t}
 useEffect(()=>{
  if(!EDITOR_EMBED)return
  const send=(type:string,detail:Record<string,unknown>={})=>{
   if(type==='close')window.dispatchEvent(new Event('xmf-editor:can-park'))
   parent.postMessage({type:`xmf-model-editor:${type}`,...detail},location.origin)
  }
  const receive=async(event:MessageEvent)=>{
   if(event.origin!==location.origin||event.source!==parent||working.current)return
   const command=event.data?.type
   if(!['xmf-model-editor:inspect','xmf-model-editor:save','xmf-model-editor:discard','xmf-model-editor:keep','xmf-model-editor:rename'].includes(command))return
   working.current=true
   try{
    const {api,collab}=live.current
    if(command==='xmf-model-editor:rename'){
     const active=api.tabs.find(tab=>tab.tabId===api.activeTabId)
     if(!active||api.readOnly)return
     const name=await api.askName(live.current.t('chrome.renameDesign'),live.current.t('saves.saveOk'),active.name)
     if(name!==null){if(active.planId)collab.renamePlan(active.planId,name);else{api.renameTab(active.tabId,name);await api.saveCurrent(name)}}
     return
    }
    if(command==='xmf-model-editor:inspect'){
     if(collab.mode==='plan'){
      const session=collab.session
      if(!session||!session.synced)throw new Error(live.current.t('sync.failed'))
      const changed=!session.plan.data||modelContent(session.toJSON())!==modelContent(session.plan.data)||session.name!==session.plan.name
      if(changed&&collab.canEdit)await session.exportNow()
      await api.checkpointEditor();send('close');return
     }
     const state=api.editorState();await api.checkpointEditor();send(state.dirty?'unsaved':'close',{...state});return
    }
    if(command==='xmf-model-editor:save'){
     const active=api.tabs.find(tab=>tab.tabId===api.activeTabId)
     let name
     if(active&&!active.docId&&!active.libraryId&&isUntitledName(active.name)){
      const typed=await api.askName(live.current.t('saves.saveTitle'),live.current.t('saves.saveOk'),'')
      if(typed===null){send('save-cancelled');return}
      name=typed.trim()||live.current.t('tab.untitled')
     }
     const saved=await api.saveCurrent(name)
     if(!saved&&api.saveWasCancelled()){send('save-cancelled');return}
     if(!saved||api.editorState().dirty)throw new Error(live.current.t('sync.failed'))
    }
    if(command==='xmf-model-editor:discard')await api.discardEditor()
    else await api.checkpointEditor()
    send('close')
   }catch(error){send('error',{message:error instanceof Error?error.message:String(error),recoverable:true,collaboration:live.current.collab.mode==='plan'})}
   finally{working.current=false;const {api}=live.current;send('state',{name:api.tabs.find(tab=>tab.tabId===api.activeTabId)?.name||'',busy:false})}
  }
  const identity=()=>send('invalidated')
  const leaving=()=>send('loading')
  window.addEventListener('message',receive);window.addEventListener('quadro-account-invalidated',identity)
  window.addEventListener('pagehide',leaving)
  send('mounted',{protocol:2})
  return()=>{window.removeEventListener('message',receive);window.removeEventListener('quadro-account-invalidated',identity);window.removeEventListener('pagehide',leaving)}
 },[])
 useEffect(()=>{
  if(!EDITOR_EMBED||announced.current)return
  if(api.error||collab.error){parent.postMessage({type:'xmf-model-editor:error',message:api.error||collab.error},location.origin);return}
  const entry=bootEntry(),active=api.tabs.find(tab=>tab.tabId===api.activeTabId)
  if(!api.ready||!api.entryReady||!active)return
  if(entry.plan&&(!collab.session?.synced||active.planId!==entry.plan))return
  const sourceLibrary=entry.src?.match(/^\/quadro\/library\/([a-f0-9]+)\/native$/)?.[1]
  if(sourceLibrary&&active.libraryId!==sourceLibrary)return
  announced.current=true
  void(async()=>{
   await api.checkpointEditor()
   const scope=String(storage.getAccountScope())
   document.documentElement.dataset.editorReady='true'
   parent.postMessage({type:'xmf-model-editor:ready',protocol:2,reuseProtocol:1,owner:scope.startsWith('user:')?scope.slice(5):'',name:active.name,libraryId:active.libraryId||null,planId:active.planId||null},location.origin)
   if(new URLSearchParams(location.search).get('editorRename')!=='1')return
   working.current=true
   const name=await api.askName(t('chrome.renameDesign'),t('saves.saveOk'),active.name)
   if(name!==null){if(active.planId)collab.renamePlan(active.planId,name);else{api.renameTab(active.tabId,name);await api.saveCurrent(name)}}
  })().catch(error=>parent.postMessage({type:'xmf-model-editor:error',message:String(error),recoverable:true},location.origin)).finally(()=>{working.current=false;parent.postMessage({type:'xmf-model-editor:state',name:live.current.api.tabs.find(tab=>tab.tabId===live.current.api.activeTabId)?.name||'',busy:false},location.origin)})
 },[api,collab,t])
 useEffect(()=>{
  if(!EDITOR_EMBED||!announced.current)return
  const active=api.tabs.find(tab=>tab.tabId===api.activeTabId)
  parent.postMessage({type:'xmf-model-editor:state',name:active?.name||'',busy:working.current||api.saving||!!api.nameAsk||!!api.exportingManual||!!api.accountAsk},location.origin)
 },[api.activeTabId,api.tabs,api.nameAsk,api.exportingManual,api.accountAsk,api.saving])
 return null
}
