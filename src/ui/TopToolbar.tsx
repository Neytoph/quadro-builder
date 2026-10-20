import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { labelOf } from '../names'
import { CONN_CAT_ICON, Svg16, TOOL_ICON, tubeIcon } from './icons'
import { UI_ESCAPE_EVENT } from './events'
import { NARROW_MAX, toolbarTop, usePanelLayout } from './panelLayout'
import { installationChoices, installationActive, type CatalogueTool } from '../store/installationCatalogue'
import { CATALOGUE_TOOLS, TOOL_LABELS } from '../store/toolMemory'
import InstallationCatalogueMenu from './InstallationCatalogueMenu'
import { MOTION, usePresence } from './motion'
import { Pop } from './Pop'
import StatusTip from './StatusTip'
import AccessoryInstallation from './AccessoryInstallation'
import { LayoutGrid, MessageSquarePlus, Shapes, Scan } from 'lucide-react'
import { useCollab } from '../collab/CollabContext'
import { useOverflowCompact } from './useOverflowCompact'
import { useDock } from './dock'
import { CUSTOM_COMPONENTS_EVENT } from './CustomComponentsMenu'
import { customComponentStrings } from './customComponentStrings'

export default function TopToolbar() {
  const api = useEngine()
  const collab = useCollab()
  const { setPane } = useDock()
  const commenting = collab.mode === 'plan' && collab.role !== 'guest'
  const locked = collab.mode === 'plan' && !collab.canEdit
  const { t, lang } = useI18n()
  const { vw, left, setToolbarW } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const barRef = useRef<HTMLDivElement>(null)
  const compact = useOverflowCompact(barRef)
  const [open, setOpen] = useState<CatalogueTool | null>(null)
  const [browsing, setBrowsing] = useState<CatalogueTool>('tubes')
  const [requestId, setRequestId] = useState(0)
  const close = useCallback(() => setOpen(null), [])
  const browse = useCallback((tool: CatalogueTool) => setBrowsing(tool), [])
  const toggle = (tool: CatalogueTool) => {
    setRequestId(id => id + 1)
    setOpen(previous => previous && browsing === tool ? null : tool)
    setBrowsing(tool)
  }
  const [shown, leaving] = usePresence(open)

  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const update = () => setToolbarW(el.scrollWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [setToolbarW])
  useEffect(() => {
    window.addEventListener(UI_ESCAPE_EVENT, close)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, close)
  }, [close])
  useEffect(close, [api.activeTabId, api.readOnly, close])

  const entries = api.catalog.tubes.length ? installationChoices(api, t) : []
  const selectedEntry = entries.find(entry => installationActive(entry, api))
  const activeTool = api.mode === 'slide' ? 'slides' : selectedEntry?.tool
  useLayoutEffect(() => {
    const bar = barRef.current
    const tool = open ? browsing : activeTool
    const button = bar?.querySelector<HTMLElement>(`[data-ui="catalogue-tool-${tool}"]`)
    if (!bar || !button) return
    const b = bar.getBoundingClientRect(), r = button.getBoundingClientRect()
    if (r.left < b.left + 8) bar.scrollBy({ left: r.left - b.left - 8, behavior: MOTION ? 'smooth' : 'instant' })
    else if (r.right > b.right - 8) bar.scrollBy({ left: r.right - b.right + 8, behavior: MOTION ? 'smooth' : 'instant' })
  }, [browsing, activeTool, open])
  const tube = api.catalog.tubes.find(part => part.id === api.tubeId)
  const curved = api.catalog.curved.some(part => part.id === api.tubeId)
  let tubeMark = tube ? `${tube.length_cm} cm` : ''
  if (curved) tubeMark = t('hint.curved')
  const panel = api.catalog.panels.find(part => part.id === api.panelId)
  const panelMark = activeTool === 'panels' && panel ? labelOf(panel.id, panel.name) : ''
  const icons: Record<CatalogueTool, string> = { tubes: tubeIcon(api.tubeId, tube?.length_cm), panels: TOOL_ICON.panel,
    connectors: CONN_CAT_ICON['6way'], wheels: TOOL_ICON.wheel, textiles: TOOL_ICON.textile,
    pools: TOOL_ICON.pool, slides: TOOL_ICON.slide, accessories: TOOL_ICON.textile, reinforce: TOOL_ICON.reinforce }
  const sep = <div className="qb-toolbar-divider" aria-hidden="true" />

  return <>
    <div data-ui="toolbar-wrap" className={`fixed z-50 flex flex-col items-stretch gap-1.5 pointer-events-none ${narrow ? 'left-2 right-2' : 'left-1/2 -translate-x-1/2 items-center'}`} style={{ top: toolbarTop(left, vw) }}>
      <div ref={barRef} data-compact={compact} data-tour="toolbar" role="toolbar" aria-label={t('chrome.tools')} className="qb-card qb-top-toolbar relative flex items-stretch gap-0.5 p-1 pointer-events-auto max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none">
        <div className={`contents ${locked ? 'qb-locked' : ''}`}>
          <button disabled={!api.canUndo} onClick={api.undo} title={t('hint.undo')} aria-label={t('hint.undo')} className="qb-tool qb-history-tool"><Svg16 inner={TOOL_ICON.undo} /><span>{t('tool.undo')}</span></button>
          <button disabled={!api.canRedo} onClick={api.redo} title={t('hint.redo')} aria-label={t('hint.redo')} className="qb-tool qb-history-tool"><Svg16 inner={TOOL_ICON.redo} /><span>{t('tool.redo')}</span></button>
        </div>
        {sep}
        <button className="m-tool qb-tool" data-ui="tool-select" title={narrow ? t('tool.select') : `${t('tool.select')} · Esc · ${t('keys.toggleTool')} (Space)`} aria-label={t('tool.select')} aria-pressed={api.mode === 'select' && !api.boxSelect && !collab.placingPin} data-mode-on={api.mode === 'select' && !api.boxSelect && !collab.placingPin} onClick={() => { api.setMode('select'); collab.setPlacingPin(false); close() }}>
          <Svg16 inner={TOOL_ICON.select} /><span>{t('tool.select')}</span>{!narrow && <kbd className="qb-tool-key" aria-hidden="true">Esc</kbd>}
        </button>
        <button type="button" className="m-tool qb-tool" data-ui="tool-box-select" title={t('tip.boxSelect')} aria-label={t('tool.boxSelect')} aria-pressed={api.boxSelect && !collab.placingPin} data-mode-on={api.boxSelect && !collab.placingPin} onClick={() => { api.setBoxSelect(!api.boxSelect); collab.setPlacingPin(false); close() }}>
          <Scan size={18} strokeWidth={1.7} /><span>{t('tool.boxSelect')}</span>{!narrow && <kbd className="qb-tool-key" aria-hidden="true">{t('keys.middleMouse')}</kbd>}
        </button>
        <div className={`contents ${locked ? 'qb-locked' : ''}`}>
          <button className="m-tool qb-tool" data-mode-on={api.mode === 'delete'} aria-pressed={api.mode === 'delete'} data-tone="red" title={t('tool.deleteHint')} aria-label={t('tool.deleteHint')} onClick={() => { api.setMode(api.mode === 'delete' ? 'select' : 'delete'); close() }}>
            <Svg16 inner={TOOL_ICON.delete} /><span>{t('tool.delete')}</span>{!narrow && <kbd className="qb-tool-key" aria-hidden="true">D</kbd>}
          </button>
          {sep}
          {CATALOGUE_TOOLS.map(tool => {
            let mark = ''
            if (tool === 'tubes') mark = tubeMark
            if (tool === 'panels') mark = panelMark
            const title = [t(TOOL_LABELS[tool]), mark].filter(Boolean).join(' · ')
            return <button key={tool} type="button" title={title} aria-label={title} data-tour={tool === 'tubes' ? 'tool-tubes' : undefined} data-mode-on={activeTool === tool} data-open={!!open && browsing === tool} aria-expanded={!!open && browsing === tool} aria-pressed={activeTool === tool} data-ui={`catalogue-tool-${tool}`} className="m-tool qb-tool" onClick={() => toggle(tool)}>
                {tool === 'accessories' ? <Shapes size={18} strokeWidth={1.7} /> : <Svg16 inner={icons[tool]} />}<span>{t(TOOL_LABELS[tool])}</span>
              </button>
          })}
          <button type="button" className="m-tool qb-tool" data-ui="tool-custom-components" title={narrow ? customComponentStrings[lang].title : `${customComponentStrings[lang].title} · 4`} aria-label={customComponentStrings[lang].title} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            close()
            window.dispatchEvent(new CustomEvent(CUSTOM_COMPONENTS_EVENT, { detail: { x: rect.left + rect.width / 2, y: rect.bottom + 8 } }))
          }}><LayoutGrid size={16} strokeWidth={2} /><span>{customComponentStrings[lang].title}</span>{!narrow && <kbd className="qb-tool-key" aria-hidden="true">4</kbd>}</button>
        </div>
        {commenting && <>{sep}<button className="m-tool qb-tool" data-mode-on={collab.placingPin} aria-pressed={collab.placingPin} title={t('collab.pin.toolHint')} aria-label={t('collab.pin.toolHint')} data-ui="tool-comment" data-tour="tool-comment" onClick={() => {
          api.setMode('select'); collab.setPinDraft(null)
          if (!collab.placingPin) { setPane(null); collab.setActiveThread(null) }
          collab.setPlacingPin(!collab.placingPin); close()
        }}><MessageSquarePlus size={16} strokeWidth={2} /><span>{t('collab.pin.tool')}</span></button></>}
      </div>
    </div>
    {shown && <Pop anchor={barRef.current} leaving={leaving} onClose={close} align="center" width={472} className="ic-popover" belowOnly>
      <InstallationCatalogueMenu tool={shown} requestId={requestId} entries={entries} onBrowse={browse} onClose={close} />
    </Pop>}
    <StatusTip menuOpen={open !== null} />
    <AccessoryInstallation menuOpen={open !== null} />
  </>
}
