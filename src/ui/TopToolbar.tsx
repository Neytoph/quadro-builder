import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { CONN_KIND_ORDER, connKindLabel, labelOf } from '../names'
import { ACC_CAT_ICON, CONN_CAT_ICON, PartImg, Svg16, TOOL_ICON, partIcon, tubeIcon } from './icons'
import { UI_ESCAPE_EVENT } from './events'
import { NARROW_MAX, toolbarTop, usePanelLayout } from './panelLayout'
import { ACCESSORY_PACK, ACCESSORY_IDS } from '../engine/accessoryPack.js'
import { MOTION, usePresence } from './motion'
import { Pop } from './Pop'
import StatusTip from './StatusTip'
import { MessageSquarePlus } from 'lucide-react'
import { useCollab } from '../collab/CollabContext'

/** 下拉菜单里零件图的边长（px）。渲染图太小看不出形状。 */
const ICON = 44

const TUBE_HOTKEY: Record<string, string> = { T15: '1', T25: '2', T35: '3', T10: '4', T20: '5', T75: '6' }

function DropItem({ on, onClick, title, img, label, compat }: {
  on: boolean
  onClick: () => void
  title?: string
  img: ReactNode
  label: string
  compat?: boolean
}) {
  return (
    <button type="button" data-on={on} onClick={onClick} title={title} className="qb-drop-item">
      {img}
      <span className="whitespace-nowrap overflow-hidden text-ellipsis max-w-full">{label}</span>
      {compat && <i className="qb-compat not-italic">兼容</i>}
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
  width = 392,
}: {
  open: boolean
  active: boolean
  onClick: () => void
  onClose: () => void
  title?: string
  children: ReactNode
  menu: ReactNode
  tour?: string
  width?: number
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [shown, leaving] = usePresence(open ? true : null)
  return (
    <>
      <button ref={ref} type="button" title={title} data-tour={tour} data-mode-on={active} data-open={open} className="m-tool qb-tool" onClick={onClick}>{children}</button>
      {shown && (
        <Pop anchor={ref.current} leaving={leaving} onClose={onClose} align="center" width={width}>
          <div className="qb-drop">{menu}</div>
        </Pop>
      )}
    </>
  )
}

const REGULAR_JOINT = new Set(['6way', '5way', '4way', '3way', 'cross', 't', 'straight', 'elbow'])
const JOINT_FITTING = new Set(['hole_1', 'hole_2', 'hole_t', 'flexi_bolt', 'flexi_hinge', 'bearing-clamp'])
const WHEEL_QDF = new Set(['multi-wheel2', 'floating-wheel2', 'casters2', 'steering-lock2', 'hub-cap2', 'bearing2', 'adapter2'])
const TEXTIL_QDF = new Set(['textil2', 'textil-round2', 'roof2', 'roof-large2', 'lattice2', 'bag2', 'sleeve'])

function pickJoint(id: string, api: ReturnType<typeof useEngine>) {
  if (id === 'diagonal') { api.startC45(); return }
  if (id === 'double_tube' || id === 'tube_clamp') { api.setClamp(id); return }
  if (id === 'bearing') { api.setFitting('bearing-clamp'); return }
  if (id === 'hole_1' || id === 'hole_2' || id === 'hole_t') { api.setFitting(id); return }
  if (id === 'flexi_bolt' || id === 'flexi_hinge') { api.setFitting(id); return }
  if (id === 'flexi') { api.setFitting('flexi_bolt'); return }
  if (REGULAR_JOINT.has(id)) { api.placeConnector(id); return }
  api.setMode('add')
}

function jointActive(id: string, api: ReturnType<typeof useEngine>) {
  if (id === 'diagonal') return api.mode === 'c45'
  if (id === 'double_tube' || id === 'tube_clamp') return api.mode === 'clamp' && api.clampPart === id
  if (id === 'bearing') return api.mode === 'fitting' && api.fittingKind === 'bearing-clamp'
  if (id === 'hole_1' || id === 'hole_2' || id === 'hole_t') return api.mode === 'fitting' && api.fittingKind === id
  if (id === 'flexi_bolt' || id === 'flexi_hinge') return api.mode === 'fitting' && api.fittingKind === id
  if (id === 'flexi') return api.mode === 'fitting' && api.fittingKind === 'flexi_bolt'
  return api.placingConnector === id
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
  const [open, setOpen] = useState<string | null>(null)
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

  const wheels = api.catalog.accessories.filter(a => a.qdf && ['multi-wheel2', 'floating-wheel2', 'casters2', 'steering-lock2', 'hub-cap2', 'bearing2', 'adapter2'].includes(a.qdf))
  const textiles = api.catalog.accessories.filter(a => a.qdf && ['textil2', 'textil-round2', 'roof2', 'roof-large2', 'lattice2', 'bag2'].includes(a.qdf))
  // 四种内衬，末尾跟着海洋球（往现成的泳池里倒）
  const pools = api.catalog.accessories.filter(a => a.id.startsWith('pool_liner') || a.id === 'balls')
  const slides = [
    { id: 'slide-new2', part: 'slide_integral' },
    { id: 'slide2', part: 'slide_module' },
    { id: 'curved-slide2', part: 'slide_curved' },
    { id: 'slide-end2', part: 'slide_end' },
  ]
  const tubeDef = api.catalog.tubes.find(x => x.id === api.tubeId)
  const tubeCurved = api.catalog.curved.some(c => c.id === api.tubeId)
  const tubeMark = tubeCurved ? t('hint.curved') : (tubeDef ? `${tubeDef.length_cm} cm` : '')
  const panelDef = api.catalog.panels.find(p => p.id === api.panelId)
  // 洞洞板和透明窗板与 40×40 同尺寸，尺寸后面带一个词区分
  type PanelLike = { w?: number; h?: number; holes?: number; acrylic?: boolean; feature?: string; compat?: boolean }
  const panelLabel = (p: PanelLike) => {
    if (!p.w || !p.h) return ''
    const variant = p.holes ? t('panel.hole') : p.acrylic ? t('panel.acrylic') : p.feature ? t('panel.' + p.feature) : ''
    return `${p.w}×${p.h}${variant ? ` · ${variant}` : ''}`
  }
  // 顶栏按钮位置窄：特殊板只显示那个词，普通板显示尺寸
  const panelMark = !panelDef ? ''
    : panelDef.holes ? t('panel.hole')
    : panelDef.acrylic ? t('panel.acrylic')
    : (panelDef as PanelLike).feature ? t('panel.' + (panelDef as PanelLike).feature)
    : panelLabel(panelDef)
  // 下拉分两组：原厂在前，功能板（兼容件）在后
  const officialPanels = api.catalog.panels.filter(p => !(p as PanelLike).compat)
  const compatPanels = api.catalog.panels.filter(p => (p as PanelLike).compat)

  const sep = <div className="w-px bg-teal-200 mx-0.5 my-2 self-stretch shrink-0" />
  const plain = 'flex items-center justify-center min-w-[2.5rem] h-12 px-2 rounded-[14px] text-gray-300 hover:bg-teal-100 hover:text-gray-100 disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0'

  return (
    <>
    <div
      data-ui="toolbar-wrap"
      className={`fixed z-50 flex flex-col items-stretch gap-1.5 pointer-events-none ${narrow ? 'left-2 right-2' : 'left-1/2 -translate-x-1/2 items-center'}`}
      style={{ top: toolbarTop(left, vw) }}
    >
      <div ref={barRef} data-tour="toolbar" className="qb-card relative flex items-stretch gap-0.5 p-1 pointer-events-auto max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none">
      {MOTION && <span ref={indRef} aria-hidden className="m-tool-ind" />}
      {/* 共享方案里的评论者：只有「选择」和「评论」能用，其余灰掉 */}
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>
      <button disabled={!api.canUndo} onClick={api.undo} title={t('hint.undo')} className={plain}>
        <Svg16 inner={TOOL_ICON.undo} />
      </button>
      <button disabled={!api.canRedo} onClick={api.redo} title={t('hint.redo')} className={plain}>
        <Svg16 inner={TOOL_ICON.redo} />
      </button>
      </div>
      {sep}

      <button className="m-tool qb-tool" data-mode-on={api.mode === 'select' && !collab.placingPin} onClick={() => { api.setMode('select'); collab.setPlacingPin(false); close() }}>
        <Svg16 inner={TOOL_ICON.select} />{t('tool.select')}
      </button>
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>
      <button className="m-tool qb-tool" data-mode-on={api.mode === 'delete'} data-tone="red" title={t('tool.deleteHint')}
        onClick={() => { api.setMode(api.mode === 'delete' ? 'select' : 'delete'); close() }}>
        <Svg16 inner={TOOL_ICON.delete} />{t('tool.delete')}
      </button>
      </div>
      {sep}
      <div className={`contents ${locked ? 'qb-locked' : ''}`}>

      <ToolDrop
        tour="tool-tubes"
        open={open === 'tubes'}
        active={api.mode === 'add' && !api.placingConnector}
        onClick={() => { api.setMode('add'); toggle('tubes') }}
        onClose={close}
        menu={(
          <>
            <div className="qb-drop-h">{t('tool.tubes')} · {t('onboard.s2hint')}</div>
            {api.catalog.tubes.map(tube => (
              <DropItem key={tube.id} on={api.tubeId === tube.id} onClick={() => { api.setTube(tube.id); close() }}
                title={TUBE_HOTKEY[tube.id] ? t('hint.tubeKey', { n: tube.length_cm, k: TUBE_HOTKEY[tube.id] }) : undefined}
                img={<PartImg id={tube.id} svg={tubeIcon(tube.id, tube.length_cm)} size={ICON} />}
                label={`${tube.length_cm} cm`} />
            ))}
            {api.catalog.curved.map(c => (
              <DropItem key={c.id} on={api.tubeId === c.id} onClick={() => { api.setTube(c.id); close() }}
                img={<PartImg id={c.id} svg={tubeIcon(c.id)} size={ICON} />} label={t('hint.curved')} />
            ))}
          </>
        )}
      >
        <Svg16 inner={tubeIcon(api.tubeId, tubeDef?.length_cm)} />
        <span>{t('tool.tubes')}</span>
        {tubeMark ? <small>{tubeMark}</small> : null}
      </ToolDrop>

      <ToolDrop
        open={open === 'panels'}
        active={api.mode === 'panel'}
        onClick={() => { api.setMode('panel'); toggle('panels') }}
        onClose={close}
        menu={(
          <>
            {officialPanels.map(p => (
              <DropItem key={p.id} on={api.panelId === p.id} onClick={() => { api.setPanel(p.id); close() }}
                img={<PartImg id={p.id} svg={partIcon(p.id, 'panels')} size={ICON} />}
                label={panelLabel(p) || labelOf(p.id, p.name)} />
            ))}
            {compatPanels.length > 0 && <div className="qb-drop-h">{t('panel.compat')}</div>}
            {compatPanels.map(p => (
              <DropItem key={p.id} on={api.panelId === p.id} onClick={() => { api.setPanel(p.id); close() }} compat
                img={<PartImg id={p.id} svg={partIcon(p.id, 'panels')} size={ICON} />}
                label={panelLabel(p) || labelOf(p.id, p.name)} />
            ))}
          </>
        )}
      >
        <Svg16 inner={TOOL_ICON.panel} />
        <span>{t('tool.panels')}</span>
        {panelMark ? <small>{panelMark}</small> : null}
      </ToolDrop>

      <ToolDrop
        open={open === 'conn'}
        active={api.mode === 'c45' || api.mode === 'clamp' || !!api.placingConnector || (api.mode === 'fitting' && JOINT_FITTING.has(api.fittingKind))}
        onClick={() => toggle('conn')}
        onClose={close}
        menu={CONN_KIND_ORDER.map(kind => {
          const items = api.catalog.connectors.filter(c => c.kind === kind)
          if (!items.length) return null
          return (
            <div key={kind} className="contents">
              <div className="qb-drop-h">{connKindLabel(kind)}</div>
              {items.map(c => (
                <DropItem key={c.id} on={jointActive(c.id, api)} onClick={() => { pickJoint(c.id, api); close() }}
                  img={<PartImg id={c.id} svg={CONN_CAT_ICON[c.id] ?? CONN_CAT_ICON['6way']} size={ICON} />}
                  label={labelOf(c.id, c.name)} />
              ))}
            </div>
          )
        })}
      >
        <Svg16 inner={CONN_CAT_ICON['6way']} />
        <span>{t('tool.connections')}</span>
      </ToolDrop>

      {sep}

      <ToolDrop
        open={open === 'wheels'}
        active={api.mode === 'fitting' && WHEEL_QDF.has(api.fittingKind)}
        onClick={() => toggle('wheels')}
        onClose={close}
        menu={wheels.map(a => (
          <DropItem key={a.id} on={!!a.qdf && api.fittingKind === a.qdf && api.mode === 'fitting'}
            onClick={() => { if (a.qdf) api.setFitting(a.qdf); close() }}
            img={<PartImg id={a.id} svg={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.wheel} size={ICON} />}
            label={labelOf(a.id, a.name)} />
        ))}
      >
        <Svg16 inner={TOOL_ICON.wheel} />
        <span>{t('tool.wheels')}</span>
      </ToolDrop>
      <ToolDrop
        open={open === 'textiles'}
        active={api.mode === 'fitting' && TEXTIL_QDF.has(api.fittingKind)}
        onClick={() => toggle('textiles')}
        onClose={close}
        menu={(
          <>
            {textiles.map(a => (
              <DropItem key={a.id}
                on={!!a.qdf && api.fittingKind === a.qdf && api.mode === 'fitting' && (a.variant ? api.fittingPart === a.id : !api.fittingPart)}
                onClick={() => { if (a.qdf) api.setFitting(a.qdf, a.variant ? a.id : undefined); close() }}
                img={<PartImg id={a.id} svg={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.textile} size={ICON} />}
                label={labelOf(a.id, a.name)} />
            ))}
            {/* 软包滚筒：套在管子上，不是布件，但归在这一栏最顺手 */}
            <DropItem on={api.fittingKind === 'sleeve' && api.mode === 'fitting'} onClick={() => { api.setFitting('sleeve', 'sleeve'); close() }}
              img={<PartImg id="sleeve" svg={TOOL_ICON.textile} size={ICON} />} label={labelOf('sleeve')} />
          </>
        )}
      >
        <Svg16 inner={TOOL_ICON.textile} />
        <span>{t('tool.textiles')}</span>
      </ToolDrop>
      <ToolDrop
        open={open === 'pools'}
        active={api.poolLinerId != null && (api.mode === 'fitting' || api.pasting)}
        onClick={() => toggle('pools')}
        onClose={close}
        menu={pools.map(a => (
          <DropItem key={a.id} on={api.poolLinerId === a.id && (api.mode === 'fitting' || api.pasting)}
            onClick={() => { api.startPool(a.id); close() }}
            img={<PartImg id={a.id} svg={TOOL_ICON.pool} size={ICON} />} label={labelOf(a.id, a.name)} />
        ))}
      >
        <Svg16 inner={TOOL_ICON.pool} />
        <span>{t('tool.pools')}</span>
      </ToolDrop>
      <ToolDrop
        open={open === 'slides'}
        active={api.mode === 'slide'}
        onClick={() => toggle('slides')}
        onClose={close}
        menu={slides.map(s => (
          <DropItem key={s.id} on={api.slideKind === s.id && api.mode === 'slide'} onClick={() => { api.setSlide(s.id); close() }}
            img={<PartImg id={s.part} svg={TOOL_ICON.slide} size={ICON} />} label={labelOf(s.part)} />
        ))}
      >
        <Svg16 inner={TOOL_ICON.slide} />
        <span>{t('tool.slides')}</span>
      </ToolDrop>

      {sep}

      <ToolDrop
        open={open === 'accessories'}
        active={api.mode === 'fitting' && ACCESSORY_IDS.has(api.fittingKind)}
        onClick={() => toggle('accessories')}
        onClose={close}
        menu={ACCESSORY_PACK.map(part => (
          <DropItem key={part.id} on={api.mode === 'fitting' && api.fittingKind === part.id} onClick={() => { api.setFitting(part.id, part.id); close() }} compat
            img={<PartImg id={part.id} svg={TOOL_ICON.textile} size={ICON} />} label={labelOf(part.id, part.name)} />
        ))}
      >
        <Svg16 inner={TOOL_ICON.textile} />
        <span>{t('tool.accessories')}</span>
      </ToolDrop>

      <button className="m-tool qb-tool" data-mode-on={api.mode === 'reinforce'} title={t('tool.reinforceHint')} onClick={() => { api.startReinforce(); close() }}>
        <Svg16 inner={TOOL_ICON.reinforce} />{t('tool.reinforce')}
      </button>
      </div>
      {commenting && <>
        {sep}
        {/* 共享方案：放一颗图钉写位置评论（快捷键 C） */}
        <button className="m-tool qb-tool" data-mode-on={collab.placingPin} title={t('collab.pin.toolHint')} data-ui="tool-comment" data-tour="tool-comment"
          onClick={() => { api.setMode('select'); collab.setPinDraft(null); collab.setPlacingPin(!collab.placingPin); close() }}>
          <MessageSquarePlus size={16} strokeWidth={2} />{t('collab.pin.tool')}
        </button>
      </>}
      </div>
    </div>
    {/* 工具提示跟工具条那一层并排，自己按屏幕定位：那一层带着 transform，里面的 fixed 会以它为准 */}
    <StatusTip menuOpen={open !== null} />
    </>
  )
}
