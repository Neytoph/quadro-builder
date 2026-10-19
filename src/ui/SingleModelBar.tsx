import { Save, FileArchive, Menu } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useEngine } from '../store/EngineContext'
import { useCollab } from '../collab/CollabContext'
import { useI18n } from '../i18n'
import { EDITOR_EMBED } from '../entry'
import { storage } from '../engine-api'
import { usePanelLayout, projectBarHeight } from './panelLayout'
import { useDock, DOCK_PILLS, PLAN_PILLS } from './dock'
import { DockIcon } from './DockIcon'
import { displaySaveState } from '../store/personalTabs'
import MyModelsLink from './MyModelsLink'
import { Pop } from './Pop'
import { usePresence } from './motion'
import './singleModel.css'

export function DeviceDraftsLink() {
  const { t, lang } = useI18n()
  return <a className="qb-file-row" data-tour="device-drafts" href={`/builder/?recover=1&lang=${lang}`} target="_blank" rel="noopener"><FileArchive size={18} aria-hidden="true"/><span>{t('single.find')}</span></a>
}

export default function SingleModelBar() {
  const api = useEngine(), collab = useCollab(), { t } = useI18n(), { vw } = usePanelLayout(), { pane, toggle } = useDock()
  const [menu,setMenu]=useState(false),[shown,leaving]=usePresence(menu?true:null),anchor=useRef<HTMLButtonElement>(null),content=useRef<HTMLDivElement>(null),[saving,setSaving]=useState(false)
  const closeMenu=useCallback(()=>setMenu(false),[])
  useEffect(()=>{if(menu)content.current?.querySelector<HTMLButtonElement>('button')?.focus()},[menu])
  const active = api.tabs.find(tab => tab.tabId === api.activeTabId)
  const plan = collab.mode === 'plan', bound = !!(active?.docId || active?.libraryId || active?.planId)
  const items = DOCK_PILLS.filter(item => ['file','bom','inventory','safety'].includes(item.id) || item.id === 'library' && !bound && !EDITOR_EMBED)
  const rename = async () => {
    if (!active || api.readOnly) return
    const name = await api.askName(t('single.name'), t('chrome.save'), active.name)
    if (name === null) return
    if (active.planId) await collab.renamePlan(active.planId, name)
    else api.renameTab(active.tabId, name)
  }
  return <div className={`qb-project-bar qb-single-bar fixed top-0 left-0 right-0 z-40 ${EDITOR_EMBED ? 'qb-embedded-bar' : ''}`} data-mobile={vw < 768} style={{height:projectBarHeight(vw)}}>
    {!EDITOR_EMBED && <><a href="/" className="qb-project-home shrink-0" aria-label={t('nav.home')}><img src={`${import.meta.env.BASE_URL}favicon.svg`} width={32} height={32} alt=""/></a><MyModelsLink toolbar/></>}
    <div className="qb-single-title" data-tour="current-design"><button type="button" title={t('single.name')} disabled={!api.entryReady || api.readOnly} onClick={() => void rename()}>{active?.name || t('tab.untitled')}</button><small role="status" data-ui="single-save-state">{plan ? t('single.collab') : t(String(storage.getAccountScope()) === 'anonymous' ? 'single.guest' : `sync.${displaySaveState(active || {}, active?.dirty || false)}`)}</small></div>
    {!plan && <button type="button" className="qb-single-save xmf-button" disabled={!api.ready || !api.entryReady || api.readOnly || api.saving || saving} aria-busy={api.saving || saving} onClick={() => {setSaving(true);void api.saveCurrent().finally(()=>setSaving(false))}} aria-label={t('chrome.save')}><Save size={18} aria-hidden="true"/><span>{t('chrome.save')}</span></button>}
    <nav className="qb-single-nav" aria-label={t('chrome.navigation')}>{[...items,...(plan?PLAN_PILLS:[])].map(item => <button key={item.id} type="button" data-pane={item.id} aria-expanded={pane === item.id} aria-label={t(item.labelKey)} title={t(item.labelKey)} className="qb-nav-button" onClick={() => toggle(item.id)}><DockIcon pane={item.id}/><span>{t(item.labelKey)}</span></button>)}</nav>
    <button ref={anchor} className="qb-single-menu-trigger qb-nav-button" type="button" aria-label={t('chrome.resources')} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Menu size={20}/></button>
    {shown && <Pop anchor={anchor.current} leaving={leaving} onClose={closeMenu} width={280} align="right"><div ref={content} role="menu" data-ui="mobile-topbar-dialog" className="qb-single-menu" onKeyDown={event=>{
      const controls=Array.from(content.current!.querySelectorAll<HTMLButtonElement>('button')),index=controls.indexOf(event.target as HTMLButtonElement)
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();let target=0;if(event.key==='End')target=controls.length-1;else if(event.key!=='Home')target=(index+(event.key==='ArrowUp'?-1:1)+controls.length)%controls.length;controls[target].focus()}
      if(event.key==='Escape'){event.stopPropagation();closeMenu();anchor.current?.focus()}
    }}>{[...items,...(plan?PLAN_PILLS:[])].map(item=><button type="button" key={item.id} role="menuitem" onClick={()=>{closeMenu();toggle(item.id)}}><DockIcon pane={item.id}/><span>{t(item.labelKey)}</span></button>)}</div></Pop>}
    {!EDITOR_EMBED && <div data-site-slot="help" hidden className="qb-host-help"/>}
  </div>
}
