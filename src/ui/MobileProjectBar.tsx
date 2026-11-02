import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Blocks, BookOpenCheck, Boxes, Check, ChevronDown, ClipboardList, FileText, FolderOpen, Layers, Lightbulb, Menu, Pencil, Plus, Save, ShieldCheck, Upload, Users, X } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { useCollab } from '../collab/CollabContext'
import { displaySaveState } from '../store/personalTabs'
import { useDock, type DockPane } from './dock'
import { Pop } from './Pop'
import { ONBOARDING_EVENT } from './Onboarding'
import { UI_ESCAPE_EVENT } from './events'

type MenuKind = 'plans' | 'switch' | 'files' | 'tools'

export default function MobileProjectBar({ onShare }: { onShare: () => void }) {
  const api = useEngine()
  const collab = useCollab()
  const { t } = useI18n()
  const { pane, setPane } = useDock()
  const [menu, setMenu] = useState<MenuKind | null>(null)
  const planRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLButtonElement>(null)
  const toolsRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const focusPane = useRef(false)
  const id = useId()
  const active = api.tabs.find(tab => tab.tabId === api.activeTabId)
  const planMode = collab.mode === 'plan'
  const visitor = planMode && !!collab.plan && !collab.plan.me
  const filePane = pane === 'file' || pane === 'saves'
  const toolsPane = !!pane && !filePane
  const issues = api.safety?.findings.filter(f => f.level !== 'info').length || 0
  const unread = planMode ? collab.unread.pins + collab.unread.chat : 0
  let anchor = planRef.current
  if (menu === 'files') anchor = fileRef.current
  if (menu === 'tools') anchor = toolsRef.current
  const close = useCallback(() => setMenu(null), [])
  const closeWithFocus = () => { close(); anchor?.focus() }

  useEffect(() => { close() }, [api.activeTabId, close])
  useEffect(() => {
    if (menu) contentRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menu])
  useEffect(() => {
    if (!pane || !focusPane.current) return
    focusPane.current = false
    const frame = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('#qb-right-dock button')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [pane])
  useEffect(() => {
    window.addEventListener(UI_ESCAPE_EVENT, close)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, close)
  }, [close])

  if (!active) return null
  const saveState = displaySaveState(active, active.dirty)
  const renamable = !active.planId || collab.renamable(active.planId)
  const toggle = (next: MenuKind) => {
    if (menu === next) { close(); return }
    setPane(null)
    setMenu(next)
  }
  const openPane = (next: DockPane) => {
    close()
    focusPane.current = true
    setPane(next)
  }
  const rename = async () => {
    closeWithFocus()
    const name = await api.askName(t('chrome.renameDesign'), t('saves.saveOk'), active.name)
    if (name === null) return
    if (active.planId) {
      if (collab.renamable(active.planId)) await collab.renamePlan(active.planId, name)
    } else api.renameTab(active.tabId, name)
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeWithFocus()
    } else if (event.key === 'Tab') {
      const buttons = Array.from(contentRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  const action = (run: () => void) => { closeWithFocus(); run() }
  const titles = { tools: 'chrome.resources', files: 'btn.file', switch: 'chrome.switchDesign', plans: 'chrome.currentDesign' }
  const menuTitle = t(titles[menu || 'plans'])
  let shareLabel = 'collab.create.action'
  if (planMode) shareLabel = collab.role === 'owner' ? 'collab.create.invite' : 'collab.create.members'
  const saveWarning = saveState === 'failed' || saveState === 'conflict'
  const tools = [
    { pane: 'library' as const, label: t('btn.library'), Icon: Blocks },
    { label: t('chrome.tutorial'), Icon: BookOpenCheck },
    { pane: 'advisor' as const, label: t('btn.advisor'), Icon: Lightbulb },
    { pane: 'bom' as const, label: t('side.bom'), Icon: ClipboardList },
    { pane: 'inventory' as const, label: t('side.inventory'), Icon: Boxes },
    { pane: 'safety' as const, label: t('btn.safety'), Icon: ShieldCheck },
  ].filter(item => !visitor || item.pane === 'advisor' || item.pane === 'bom' || item.pane === 'safety')

  return <>
    <button ref={planRef} type="button" className="qb-mobile-project" data-ui="mobile-project-menu"
      aria-label={`${t('chrome.currentDesign')} · ${active.name}`} title={active.name}
      aria-haspopup="dialog" aria-expanded={menu === 'plans' || menu === 'switch'} aria-controls={id}
      onClick={() => toggle(menu === 'switch' ? 'switch' : 'plans')}>
      <span className="qb-mobile-name">{active.name}</span>
      {saveWarning && <AlertTriangle size={15} aria-label={t(`sync.${saveState}`)} />}
      {!saveWarning && active.dirty && <span aria-label={t('sync.unsaved')}>•</span>}
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {!visitor && <>
      <span className="qb-mobile-divider" aria-hidden="true" />
      <button ref={fileRef} type="button" className="qb-mobile-trigger" data-ui="mobile-file-menu"
        data-pane={filePane ? pane : undefined} data-active={filePane}
        aria-label={t('btn.file')} title={t('btn.file')} aria-haspopup="dialog" aria-expanded={menu === 'files'} aria-controls={id}
        onClick={() => toggle('files')}><FolderOpen size={20} aria-hidden="true" /></button>
    </>}
    <button ref={toolsRef} type="button" className="qb-mobile-trigger" data-ui="mobile-tools-menu"
      data-pane={toolsPane ? pane : undefined} data-active={toolsPane}
      aria-label={t('chrome.resources')} title={t('chrome.resources')} aria-haspopup="dialog" aria-expanded={menu === 'tools'} aria-controls={id}
      onClick={() => toggle('tools')}>
      <Menu size={20} aria-hidden="true" />
      {unread > 0 && <span className="qb-mobile-badge" aria-label={`${t('collab.pane.comments')} · ${unread}`}>{unread > 99 ? '99+' : unread}</span>}
      {unread === 0 && issues > 0 && <span className="qb-mobile-alert" aria-label={`${t('btn.safety')} · ${issues}`} />}
    </button>
    <input ref={importRef} type="file" accept=".qdf,.json,application/json" hidden onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (file) void api.importFile(file)
    }} />
    {menu && <Pop anchor={anchor} leaving={false} onClose={close} width={336} align={menu === 'plans' || menu === 'switch' ? 'left' : 'right'} className="qb-mobile-pop">
      <div ref={contentRef} id={id} role="dialog" data-ui="mobile-topbar-dialog" aria-label={menuTitle} className="qb-mobile-menu" onKeyDown={keyDown}>
        <div className="qb-mobile-menu-heading"><span>{menuTitle}</span><button type="button" className="qb-mobile-dismiss" onClick={closeWithFocus} aria-label={t('chrome.closeMenu')}><X size={18} aria-hidden="true" /></button></div>
        {menu === 'plans' && <>
          <div className="qb-mobile-current-name">{active.name}</div>
          {!active.planId && <div className="qb-mobile-save-state" role="status" data-ui="mobile-save-state" data-save-state={saveState}>
            <span>{t(`sync.${saveState}`)}{active.statsPending ? ` · ${t('sync.statsWaiting')}` : ''}</span>
            {(saveState === 'failed' || saveState === 'local') && <button type="button" onClick={() => void api.retrySave(active.tabId)}>{t('sync.retry')}</button>}
            {saveState === 'conflict' && active.conflictDocId && <button type="button" onClick={() => { if (active.conflictDocId) { action(() => void api.openDoc(active.conflictDocId!)) } }}>{t('sync.viewLatest')}</button>}
          </div>}
          {renamable && <button type="button" className="qb-mobile-menu-item" onClick={() => void rename()}><Pencil aria-hidden="true" /><span>{t('chrome.renameDesign')}</span></button>}
          <button type="button" className="qb-mobile-menu-item" onClick={() => action(() => { api.newTab(); api.notify(t('toast.newTab')) })}><Plus aria-hidden="true" /><span>{t('btn.new')}</span></button>
          <button type="button" className="qb-mobile-menu-item" onClick={() => setMenu('switch')}><Layers aria-hidden="true" /><span>{t('chrome.switchDesign')}</span><small>{api.tabs.length}</small></button>
          {collab.enabled && collab.mode !== 'delivery' && collab.mode !== 'room' && (!planMode || !!collab.plan) && <button type="button" className="qb-mobile-menu-item" onClick={() => action(onShare)}><Users aria-hidden="true" /><span>{t(shareLabel)}</span></button>}
          {collab.createdPlan && (!planMode || !collab.plan) && <button type="button" className="qb-mobile-menu-item" onClick={() => action(collab.recoverCreatedPlan)}><Users aria-hidden="true" /><span>{t('collab.create.recover')}</span></button>}
          <hr />
          <button type="button" className="qb-mobile-menu-item qb-mobile-danger" onClick={() => {
            if (active.dirty && !window.confirm(t('confirm.closeTab'))) return
            action(() => api.closeTab(active.tabId))
          }}><X aria-hidden="true" /><span>{t('chrome.closeTab')}</span></button>
        </>}
        {menu === 'switch' && api.tabs.map(tab => <button key={tab.tabId} type="button" className="qb-mobile-menu-item qb-mobile-tab-option" aria-current={tab.tabId === active.tabId ? 'page' : undefined}
          onClick={() => action(() => api.activateTab(tab.tabId))}><FileText aria-hidden="true" /><span>{tab.name}{tab.dirty ? ' •' : ''}</span>{tab.tabId === active.tabId && <Check aria-hidden="true" />}</button>)}
        {menu === 'files' && <>
          {!planMode && <button type="button" className="qb-mobile-menu-item" onClick={() => action(() => void api.saveCurrent())}><Save aria-hidden="true" /><span>{t('chrome.save')}</span></button>}
          <button type="button" className="qb-mobile-menu-item" data-pane="saves" onClick={() => openPane('saves')}><FolderOpen aria-hidden="true" /><span>{t('btn.saves')}</span></button>
          <button type="button" className="qb-mobile-menu-item" onClick={() => action(() => importRef.current?.click())}><Upload aria-hidden="true" /><span>{t('btn.import')}</span></button>
          <button type="button" className="qb-mobile-menu-item" data-pane="file" onClick={() => openPane('file')}><FileText aria-hidden="true" /><span>{t('chrome.fileMore')}</span></button>
        </>}
        {menu === 'tools' && <>
          <div className="qb-mobile-tools-grid">{tools.map(item => <button key={item.label} type="button" className="qb-mobile-menu-item" data-pane={item.pane}
            onClick={() => item.pane ? openPane(item.pane) : action(() => window.dispatchEvent(new Event(ONBOARDING_EVENT)))}>
            <item.Icon aria-hidden="true" /><span>{item.label}</span>{item.pane === 'safety' && issues > 0 && <small>{issues}</small>}
          </button>)}</div>
          {planMode && <><hr /><div className="qb-mobile-tools-grid">
            <button type="button" className="qb-mobile-menu-item" data-pane="comments" onClick={() => openPane('comments')}><Users aria-hidden="true" /><span>{t('collab.pane.comments')}</span>{unread > 0 && <small>{unread}</small>}</button>
            <button type="button" className="qb-mobile-menu-item" data-pane="versions" onClick={() => openPane('versions')}><Layers aria-hidden="true" /><span>{t('collab.pane.versions')}</span></button>
          </div></>}
        </>}
      </div>
    </Pop>}
  </>
}
