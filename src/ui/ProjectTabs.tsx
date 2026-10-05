import { useEffect, useRef, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { TAB_BAR_H } from './panelLayout'
import { DOCK_PILLS, PLAN_PILLS, useDock } from './dock'
import { useCollab } from '../collab/CollabContext'
import ShareCluster from '../collab/ui/ShareCluster'
import { AlertTriangle, Box, Check, CloudUpload, Plus, RotateCw, X } from 'lucide-react'
import { DockChevron, DockIcon } from './DockIcon'
import { useOverflowCompact } from './useOverflowCompact'
import { displaySaveState } from '../store/personalTabs'
import './builderChrome.css'

const GROUPS: (typeof DOCK_PILLS)[] = [
  DOCK_PILLS.filter(p => p.id === 'file' || p.id === 'saves'),
  DOCK_PILLS.filter(p => p.id === 'library'),
  DOCK_PILLS.filter(p => p.id === 'advisor' || p.id === 'bom' || p.id === 'inventory'),
  DOCK_PILLS.filter(p => p.id === 'safety'),
]

// 当前标签页是共享方案：「我的库存」和「安全」之间多一组「评论 / 版本」
const PLAN_GROUPS: (typeof DOCK_PILLS)[] = [...GROUPS.slice(0, 3), PLAN_PILLS, GROUPS[3]]
// 没登录的访客：只留看的格子
const VISITOR_GROUPS: (typeof DOCK_PILLS)[] = [
  DOCK_PILLS.filter(p => p.id === 'advisor' || p.id === 'bom'),
  PLAN_PILLS,
  GROUPS[3],
]

export default function ProjectTabs() {
  const api = useEngine()
  const collab = useCollab()
  const planMode = collab.mode === 'plan'
  const { t } = useI18n()
  const { pane, toggle } = useDock()
  const [editing, setEditing] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const topbarRef = useRef<HTMLDivElement>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
  const compact = useOverflowCompact(pillsRef, topbarRef)
  const previousPane = useRef(pane)
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [api.activeTabId])
  useEffect(() => {
    if (!pane && previousPane.current && document.activeElement?.closest('[data-ui="right-dock"]')) {
      pillsRef.current?.querySelector<HTMLButtonElement>(`[data-pane="${previousPane.current}"]`)?.focus()
    }
    previousPane.current = pane
  }, [pane])

  const close = (tabId: string, dirty: boolean) => {
    if (dirty && !window.confirm(t('confirm.closeTab'))) return
    api.closeTab(tabId)
  }

  return (
    <div
      ref={topbarRef} data-compact={compact}
      className="qb-project-bar fixed top-0 left-0 right-0 z-40"
      style={{ height: TAB_BAR_H }}
    >
      <a href="/" title={t('nav.home')} className="shrink-0 flex items-center justify-center w-8 h-8 rounded-[9px] overflow-hidden">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} draggable={false} />
      </a>
      <div ref={tabsRef} className="qb-project-tabs scrollbar-none">
      {api.tabs.map(tab => {
        // 共享方案：创建人、编辑者改的是方案的名字，评论者和访客不能改
        const renamable = !tab.planId || collab.renamable(tab.planId)
        const state = displaySaveState(tab, tab.dirty)
        return (
        <div key={tab.tabId} data-plan-tab={tab.planId || undefined}
          className="m-tab qb-project-tab" data-active={tab.tabId === api.activeTabId}>
          {editing === tab.tabId ? (
            <input autoFocus defaultValue={tab.name} maxLength={tab.planId ? 40 : undefined} className="bg-transparent w-24 outline-none"
              onBlur={e => {
                if (tab.planId) collab.renamePlan(tab.planId, e.target.value)
                else api.renameTab(tab.tabId, e.target.value)
                setEditing(null)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          ) : (
            <button onClick={() => api.activateTab(tab.tabId)} onDoubleClick={() => { if (renamable) setEditing(tab.tabId) }}
              title={renamable ? `${tab.name} · ${t('hint.renameTab')}` : tab.name} className="qb-project-name" aria-current={tab.tabId === api.activeTabId ? 'page' : undefined}>
              <Box size={16} strokeWidth={1.65} aria-hidden="true" /><span>{tab.name}</span>{tab.dirty ? <span aria-hidden="true">•</span> : null}
            </button>
          )}
          {!tab.planId && tab.docId && <button type="button" data-ui="save-status" data-save-state={tab.saveState || 'unsaved'}
            className="qb-tab-close !w-auto gap-1 px-1.5 shrink-0"
            title={t(`sync.${state}`)} aria-label={t(`sync.${state}`)}
            onClick={() => {
              if (tab.saveState === 'conflict' && tab.conflictDocId) void api.openDoc(tab.conflictDocId)
              else if (tab.saveState === 'failed' || tab.saveState === 'local') void api.retrySave(tab.tabId)
            }}>
            {state === 'conflict' && <AlertTriangle size={14} />}
            {state === 'failed' && <RotateCw size={14} />}
            {state === 'synced' && <Check size={14} />}
            {!['conflict', 'failed', 'synced'].includes(state) && <CloudUpload size={14} />}
            <span className="text-[10px] max-w-24 truncate">{t(`sync.${state}`)}</span>
          </button>}
          <button onClick={() => close(tab.tabId, tab.dirty)} className="qb-tab-close"
            title={t('chrome.closeTab')} aria-label={`${t('chrome.closeTab')} · ${tab.name}`}><X size={14} aria-hidden="true" /></button>
        </div>
        )
      })}
      </div>
      <button onClick={api.newTab} className="qb-project-new" title={t('btn.new')} aria-label={t('btn.new')}><Plus size={18} aria-hidden="true" /></button>

      <div ref={pillsRef} role="navigation" aria-label={t('chrome.navigation')} className="qb-navigation scrollbar-none" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(pillsRef.current?.querySelectorAll<HTMLButtonElement>('[data-pane]') || [])
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        let next: number
        if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = buttons.length - 1
        else {
          const direction = event.key === 'ArrowLeft' ? -1 : 1
          next = (index + direction + buttons.length) % buttons.length
        }
        buttons[next]?.focus()
        buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }}>
        {(planMode ? (collab.plan && !collab.plan.me ? VISITOR_GROUPS : PLAN_GROUPS) : GROUPS).map((group, i) => (
          <div key={i} className="qb-nav-group">
            {i > 0 && <span className="qb-nav-divider" aria-hidden="true" />}
            {group.map(item => {
              const on = pane === item.id
              // 安全入口带上错误和提醒的数量；没有就打个勾
              const issues = item.id === 'safety' && api.safety
                ? api.safety.findings.filter(f => f.level !== 'info').length
                : null
              const unread = item.id === 'comments' ? collab.unread.pins + collab.unread.chat : 0
              return (
                <button key={item.id} type="button" data-tour={`dock-${item.id}`} data-pane={item.id} data-pill-on={on} onClick={() => toggle(item.id)}
                  aria-controls="qb-right-dock" aria-expanded={on} title={t(item.labelKey)} aria-label={t(item.labelKey)} className="m-pill qb-nav-button">
                  <DockIcon pane={item.id} /><span className="qb-nav-label">{t(item.labelKey)}</span>
                  {issues != null && <span className="qb-safety-mark" data-issues={issues > 0}>{issues || '✓'}</span>}
                  <DockChevron />
                  {unread > 0 && <b className="cb-n" data-unread>{unread}</b>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <ShareCluster />
      <div data-site-slot="help" hidden className="qb-host-help" />
    </div>
  )
}
