import { useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { NARROW_MAX, TAB_BAR_H, usePanelLayout } from './panelLayout'
import { DOCK_PILLS, useDock } from './dock'

const GROUPS: (typeof DOCK_PILLS)[] = [
  DOCK_PILLS.filter(p => p.id === 'file' || p.id === 'saves'),
  DOCK_PILLS.filter(p => p.id === 'library'),
  DOCK_PILLS.filter(p => p.id === 'advisor' || p.id === 'bom' || p.id === 'inventory'),
]

export default function ProjectTabs() {
  const api = useEngine()
  const { t } = useI18n()
  const { pane, toggle } = useDock()
  const { vw } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const [editing, setEditing] = useState<string | null>(null)

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
          className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs shrink-0 ${tab.tabId === api.activeTabId ? 'bg-gray-800 border-teal-500 text-teal-700' : 'bg-transparent border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-900'}`}>
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

      <div className={`flex items-center gap-1.5 ${narrow ? 'flex-1 overflow-x-auto scrollbar-thin' : 'shrink-0'}`}>
        {GROUPS.map((group, i) => (
          <div key={i} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <span className="w-px h-4 bg-gray-700 mx-0.5" />}
            {group.map(item => {
              const on = pane === item.id
              return (
                <button key={item.id} data-tour={`dock-${item.id}`} onClick={() => toggle(item.id)}
                  className={`text-xs px-2.5 min-h-8 rounded-lg cursor-pointer whitespace-nowrap ${
                    on ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300 hover:text-teal-600 hover:bg-gray-900'
                  }`}>
                  {t(item.labelKey)}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
