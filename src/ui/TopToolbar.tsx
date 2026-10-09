import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { labelOf } from '../names'
import { CONN_CAT_ICON, Svg16, TOOL_ICON, tubeIcon } from './icons'
import { UI_ESCAPE_EVENT } from './events'
import { NARROW_MAX, toolbarTop, usePanelLayout } from './panelLayout'
import { installationChoices, installationActive, type CatalogueTool } from '../store/installationCatalogue'
import InstallationCatalogueMenu from './InstallationCatalogueMenu'
import { MOTION, usePresence } from './motion'
import { Pop } from './Pop'
import StatusTip from './StatusTip'
import AccessoryInstallation from './AccessoryInstallation'
import { MessageSquarePlus } from 'lucide-react'
import { useCollab } from '../collab/CollabContext'
import { useOverflowCompact } from './useOverflowCompact'
import SlideMenu from './SlideMenu'
import type { CatalogueSource } from './CatalogueSourceSwitch'

export function DropItem({ on, onClick, title, img, label, compat }: {
  on: boolean
  onClick: () => void
  title?: string
  img: ReactNode
  label: string
  compat?: boolean
}) {
  const { t } = useI18n()
  return (
    <button type="button" data-on={on} aria-pressed={on} onClick={onClick} title={title || label} className="qb-drop-item">
      {img}
      <span className="qb-drop-label">{label}</span>
      {compat && <i className="qb-compat not-italic">{t('accessory.compat')}</i>}
    </button>
  )
}

function ToolDrop({
  open,
  active,
  onClick,
  onClose,
  title,
  children,
  menu,
  tour,
  tool,
  width = 452,
}: {
  open: boolean
  active: boolean
  onClick: () => void
  onClose: () => void
  title?: string
  children: ReactNode
  menu: ReactNode
  tour?: string
  tool?: CatalogueTool
  width?: number
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [shown, leaving] = usePresence(open ? true : null)
  return (
    <>
      <button ref={ref} type="button" title={title} aria-label={title} data-tour={tour} data-mode-on={active} data-open={open} aria-expanded={open} aria-pressed={active} data-ui={`catalogue-tool-${tool}`} className="m-tool qb-tool" onClick={onClick}>{children}</button>
      {shown && (
        <Pop anchor={ref.current} leaving={leaving} onClose={onClose} align="center" width={width}>
          {menu}
        </Pop>
      )}
    </>
  )
}

export default function TopToolbar() {
  const api = useEngine()
  const collab = useCollab()
  // 共享方案的成员能放评论图钉；评论者只能用「选择」和「评论」
  const commenting = collab.mode === 'plan' && collab.role !== 'guest'
  const locked = collab.mode === 'plan' && !collab.canEdit
  const { t } = useI18n()
  const { vw, left, setToolbarW } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const barRef = useRef<HTMLDivElement>(null)
  const compact = useOverflowCompact(barRef)
  const [open, setOpen] = useState<string | null>(null)
  const [catalogueSource, setCatalogueSource] = useState<CatalogueSource>(() => api.slideKind.includes('domestic') ? 'extended' : 'official')
  const toggle = (k: string) => setOpen(o => (o === k ? null : k))
  const close = () => setOpen(null)

  const indRef = useRef<HTMLSpanElement>(null)
  // 当前工具底下那块滑块：挪到亮着的那颗按钮底下。按钮上的字会变长变短
  // （管子长度、板子尺寸），所以每次渲染和工具条尺寸一变都重新量。
  const placeInd = () => {
    const bar = barRef.current, ind = indRef.current
    if (!bar || !ind) return
    const on = bar.querySelector<HTMLElement>('[data-mode-on="true"]')
    if (!on) { ind.style.opacity = '0'; return }
    ind.style.opacity = '1'
    ind.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
    ind.style.width = `${on.offsetWidth}px`
    ind.style.height = `${on.offsetHeight}px`
    ind.dataset.tone = on.dataset.tone || 'teal'
    // 第一次摆好之前不带过渡，不然一打开就看见它从左上角滑过来
    if (!ind.dataset.ready) requestAnimationFrame(() => { ind.dataset.ready = '1' })
  }
  useLayoutEffect(() => { if (MOTION) placeInd() })

  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const update = () => {
      setToolbarW(el.scrollWidth)
      if (MOTION) placeInd()
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [setToolbarW])

  useEffect(() => {
    const onEsc = () => close()
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [])

  const entries = api.catalog.tubes.length ? installationChoices(api, t) : []
  const selectedEntry = entries.find(entry => installationActive(entry, api))
  const activeTool = selectedEntry?.tool
  const tubeDef = api.catalog.tubes.find(x => x.id === api.tubeId)
  const tubeCurved = api.catalog.curved.some(c => c.id === api.tubeId)
  const tubeMark = tubeCurved ? t('hint.curved') : (tubeDef ? `${tubeDef.length_cm} cm` : '')
  const panelDef = api.catalog.panels.find(p => p.id === api.panelId)
  const panelMark = activeTool === 'panels' && panelDef ? labelOf(panelDef.id, panelDef.name) : ''
  const catalogueMenu = (tool: CatalogueTool) => <InstallationCatalogueMenu key={tool} tool={tool} entries={entries} source={catalogueSource} onSourceChange={setCatalogueSource} onClose={close} />

  const sep = <div className="qb-toolbar-divider" aria-hidden="true" />
  const plain = 'qb-tool qb-history-tool'

  return (
    <>
    <div
      data-ui="toolbar-wrap"
      className={`fixed z-50 flex flex-col items-stretch gap-1.5 pointer-events-none ${narrow ? 'left-2 right-2' : 'left-1/2 -translate-x-1/2 items-center'}`}
      style={{ top: toolbarTop(left, vw) }}
    >
      <div ref={barRef} data-compact={compact} data-tour="toolbar" role="toolbar" aria-label={t('chrome.tools')} className="qb-card qb-top-toolbar relative flex items-stretch gap-0.5 p-1 pointer-events-auto max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none">
      {MOTION && <span ref={indRef} aria-hidden className="m-tool-ind" />}
      {/* 共享方案里的评论者：只有「选择」和「评论」能用，其余灰掉 */}
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>
      <button disabled={!api.canUndo} onClick={api.undo} title={t('hint.undo')} aria-label={t('hint.undo')} className={plain}>
        <Svg16 inner={TOOL_ICON.undo} /><span>{t('tool.undo')}</span>
      </button>
      <button disabled={!api.canRedo} onClick={api.redo} title={t('hint.redo')} aria-label={t('hint.redo')} className={plain}>
        <Svg16 inner={TOOL_ICON.redo} /><span>{t('tool.redo')}</span>
      </button>
      </div>
      {sep}

      <button className="m-tool qb-tool" title={t('tool.select')} aria-label={t('tool.select')} aria-pressed={api.mode === 'select' && !collab.placingPin} data-mode-on={api.mode === 'select' && !collab.placingPin} onClick={() => { api.setMode('select'); collab.setPlacingPin(false); close() }}>
        <Svg16 inner={TOOL_ICON.select} /><span>{t('tool.select')}</span>
      </button>
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>
      <button className="m-tool qb-tool" data-mode-on={api.mode === 'delete'} aria-pressed={api.mode === 'delete'} data-tone="red" title={t('tool.deleteHint')} aria-label={t('tool.deleteHint')}
        onClick={() => { api.setMode(api.mode === 'delete' ? 'select' : 'delete'); close() }}>
        <Svg16 inner={TOOL_ICON.delete} /><span>{t('tool.delete')}</span>
      </button>
      </div>
      {sep}
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>

      <ToolDrop tool="tubes" title={[t('tool.tubes'), tubeMark].filter(Boolean).join(' · ')} tour="tool-tubes" open={open === 'tubes'} active={activeTool === 'tubes'} onClick={() => toggle('tubes')} onClose={close} menu={catalogueMenu('tubes')}>
        <Svg16 inner={tubeIcon(api.tubeId, tubeDef?.length_cm)} /><span>{t('tool.tubes')}</span>{tubeMark ? <small>{tubeMark}</small> : null}
      </ToolDrop>
      <ToolDrop tool="panels" title={[t('tool.panels'), panelMark].filter(Boolean).join(' · ')} open={open === 'panels'} active={activeTool === 'panels'} onClick={() => toggle('panels')} onClose={close} menu={catalogueMenu('panels')}>
        <Svg16 inner={TOOL_ICON.panel} /><span>{t('tool.panels')}</span>{panelMark ? <small title={panelMark}>{panelMark}</small> : null}
      </ToolDrop>
      <ToolDrop tool="connectors" title={t('tool.connections')} open={open === 'connectors'} active={activeTool === 'connectors'} onClick={() => toggle('connectors')} onClose={close} menu={catalogueMenu('connectors')}>
        <Svg16 inner={CONN_CAT_ICON['6way']} /><span>{t('tool.connections')}</span>
      </ToolDrop>
      {sep}
      <ToolDrop tool="wheels" title={t('tool.wheels')} open={open === 'wheels'} active={activeTool === 'wheels'} onClick={() => toggle('wheels')} onClose={close} menu={catalogueMenu('wheels')}>
        <Svg16 inner={TOOL_ICON.wheel} /><span>{t('tool.wheels')}</span>
      </ToolDrop>
      <ToolDrop tool="textiles" title={t('tool.textiles')} open={open === 'textiles'} active={activeTool === 'textiles'} onClick={() => toggle('textiles')} onClose={close} menu={catalogueMenu('textiles')}>
        <Svg16 inner={TOOL_ICON.textile} /><span>{t('tool.textiles')}</span>
      </ToolDrop>
      <ToolDrop tool="pools" title={t('tool.pools')} open={open === 'pools'} active={activeTool === 'pools'} onClick={() => toggle('pools')} onClose={close} menu={catalogueMenu('pools')}>
        <Svg16 inner={TOOL_ICON.pool} /><span>{t('tool.pools')}</span>
      </ToolDrop>
      <ToolDrop
        tool="slides" title={t('tool.slides')}
        open={open === 'slides'}
        active={api.mode === 'slide'}
        onClick={() => toggle('slides')}
        onClose={close}
        menu={<SlideMenu source={catalogueSource} onSourceChange={setCatalogueSource} onClose={close} />}
      >
        <Svg16 inner={TOOL_ICON.slide} />
        <span>{t('tool.slides')}</span>
      </ToolDrop>
      {sep}
      <ToolDrop tool="accessories" title={t('tool.accessories')} open={open === 'accessories'} active={activeTool === 'accessories'} onClick={() => toggle('accessories')} onClose={close} menu={catalogueMenu('accessories')}>
        <Svg16 inner={TOOL_ICON.textile} /><span>{t('tool.accessories')}</span>
      </ToolDrop>

      <button className="m-tool qb-tool" data-mode-on={api.mode === 'reinforce'} aria-pressed={api.mode === 'reinforce'} title={t('tool.reinforceHint')} aria-label={t('tool.reinforceHint')} onClick={() => { api.startReinforce(); close() }}>
        <Svg16 inner={TOOL_ICON.reinforce} /><span>{t('tool.reinforce')}</span>
      </button>
      </div>
      {commenting && <>
        {sep}
        {/* 共享方案：放一颗图钉写位置评论（快捷键 C） */}
        <button className="m-tool qb-tool" data-mode-on={collab.placingPin} aria-pressed={collab.placingPin} title={t('collab.pin.toolHint')} aria-label={t('collab.pin.toolHint')} data-ui="tool-comment" data-tour="tool-comment"
          onClick={() => { api.setMode('select'); collab.setPinDraft(null); collab.setPlacingPin(!collab.placingPin); close() }}>
          <MessageSquarePlus size={16} strokeWidth={2} /><span>{t('collab.pin.tool')}</span>
        </button>
      </>}
      </div>
    </div>
    {/* 工具提示跟工具条那一层并排，自己按屏幕定位：那一层带着 transform，里面的 fixed 会以它为准 */}
    <StatusTip menuOpen={open !== null} />
    <AccessoryInstallation menuOpen={open !== null} />
    </>
  )
}
