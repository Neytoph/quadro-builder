import { useLayoutEffect, useRef, useState } from 'react'
import { MOTION } from './motion'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { NARROW_MAX, TAB_BAR_H, usePanelLayout } from './panelLayout'
import { DOCK_PILLS, useDock } from './dock'

const GROUPS: (typeof DOCK_PILLS)[] = [
  DOCK_PILLS.filter(p => p.id === 'file' || p.id === 'saves'),
  DOCK_PILLS.filter(p => p.id === 'library'),
  DOCK_PILLS.filter(p => p.id === 'advisor' || p.id === 'bom' || p.id === 'inventory'),
  DOCK_PILLS.filter(p => p.id === 'safety'),
]

export default function ProjectTabs() {
  const api = useEngine()
  const { t } = useI18n()
  const { pane, toggle } = useDock()
  const { vw } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const [editing, setEditing] = useState<string | null>(null)
  const pillsRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLSpanElement>(null)

  // 右边这排面板入口底下一块会滑的色块，跟着打开的那个走；全关了就淡掉、原地不动
  useLayoutEffect(() => {
    if (!MOTION) return
    const box = pillsRef.current, ind = indRef.current
    if (!box || !ind) return
    const place = () => {
      const on = box.querySelector<HTMLElement>('[data-pill-on="true"]')
      if (!on) { ind.style.opacity = '0'; return }
      ind.style.opacity = '1'
      ind.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
      ind.style.width = `${on.offsetWidth}px`
      ind.style.height = `${on.offsetHeight}px`
      if (!ind.dataset.ready) requestAnimationFrame(() => { ind.dataset.ready = '1' })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(box)
    return () => ro.disconnect()
  })

  const close = (tabId: string, dirty: boolean) => {
    if (dirty && !window.confirm(t('confirm.closeTab'))) return
    api.closeTab(tabId)
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 flex items-center gap-2 px-2 bg-gray-950/95 border-b border-gray-800"
      style={{ height: TAB_BAR_H }}
    >
      {!narrow && (
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto scrollbar-thin">
      {api.tabs.map(tab => (
        <div key={tab.tabId}
          className={`m-tab flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs shrink-0 ${tab.tabId === api.activeTabId ? 'bg-gray-800 border-teal-500 text-teal-700' : 'bg-transparent border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900'}`}>
          {editing === tab.tabId ? (
            <input autoFocus defaultValue={tab.name} className="bg-transparent w-24 outline-none"
              onBlur={e => { api.renameTab(tab.tabId, e.target.value); setEditing(null) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          ) : (
            <button onClick={() => api.activateTab(tab.tabId)} onDoubleClick={() => setEditing(tab.tabId)}
              title={t('hint.renameTab')} className="cursor-pointer max-w-[10rem] truncate">
              {tab.name}{tab.dirty ? ' •' : ''}
            </button>
          )}
          <button onClick={() => close(tab.tabId, tab.dirty)} className="text-gray-500 hover:text-teal-600 cursor-pointer"
            title={t('saves.delete')}>×</button>
        </div>
      ))}
      <button onClick={api.newTab} className="w-6 h-6 shrink-0 rounded-md border border-gray-800 bg-gray-900/80 text-gray-300 hover:border-teal-400 cursor-pointer">+</button>
      </div>
      )}

      <div ref={pillsRef} className={`relative flex items-center gap-1.5 ${narrow ? 'flex-1 overflow-x-auto scrollbar-thin' : 'shrink-0'}`}>
        {MOTION && <span ref={indRef} aria-hidden className="m-pill-ind" />}
        {GROUPS.map((group, i) => (
          <div key={i} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <span className="w-px h-4 bg-gray-700 mx-0.5" />}
            {group.map(item => {
              const on = pane === item.id
              // 安全入口带上错误和提醒的数量；没有就打个勾
              const issues = item.id === 'safety' && api.safety
                ? api.safety.findings.filter(f => f.level !== 'info').length
                : null
              const mark = issues == null ? '' : issues ? ` · ${issues}` : ' ✓'
              const tone = issues == null || on ? '' : issues ? ' text-amber-300' : ' text-teal-400'
              return (
                <button key={item.id} data-tour={`dock-${item.id}`} data-pill-on={on} onClick={() => toggle(item.id)}
                  className={`m-pill relative z-[1] text-xs px-2.5 min-h-8 rounded-lg cursor-pointer whitespace-nowrap ${
                    on
                      ? (MOTION ? 'text-white font-semibold' : 'bg-teal-500 text-white font-semibold')
                      : `text-gray-300 hover:text-teal-600 hover:bg-gray-900${tone}`
                  }`}>
                  {t(item.labelKey)}{mark}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
