import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { CONN_KIND_ORDER, connKindLabel, labelOf } from '../names'
import { ACC_CAT_ICON, CONN_CAT_ICON, Svg16, TOOL_ICON, partIcon, tubeIcon } from './icons'
import { UI_ESCAPE_EVENT } from './events'
import { NARROW_MAX, TOP_MIN, usePanelLayout } from './panelLayout'

const TUBE_HOTKEY: Record<string, string> = { T15: '1', T25: '2', T35: '3', T10: '4', T20: '5', T75: '6' }

const btn = (active: boolean, tone: 'teal' | 'red' = 'teal') =>
  `flex flex-col items-center justify-center gap-0.5 min-w-[3.4rem] h-12 px-2 rounded-xl border text-[11px] cursor-pointer transition-colors ${
    active
      ? (tone === 'red'
        ? 'bg-red-500 text-white border-red-400 font-semibold'
        : 'bg-teal-500 text-white border-teal-400 font-semibold')
      : (tone === 'red'
        ? 'bg-gray-900/70 text-gray-200 border-gray-700 hover:border-red-400'
        : 'bg-gray-900/70 text-gray-200 border-gray-700 hover:border-teal-400')
  }`

function Pop({ anchor, children }: { anchor: HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = el.offsetWidth || 208
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8)
      setPos({ top: r.bottom + 6, left })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[60] pointer-events-auto bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-2 min-w-[13rem]"
      style={pos}
    >
      {children}
    </div>,
    document.body,
  )
}

function ToolDrop({
  open,
  active,
  onClick,
  title,
  children,
  menu,
}: {
  open: boolean
  active: boolean
  onClick: () => void
  title?: string
  children: ReactNode
  menu: ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={ref} type="button" title={title} className={btn(active)} onClick={onClick}>{children}</button>
      {open && <Pop anchor={ref.current}>{menu}</Pop>}
    </>
  )
}

const REGULAR_JOINT = new Set(['6way', '5way', '4way', '3way', 'cross', 't', 'straight', 'elbow'])
const JOINT_FITTING = new Set(['hole_1', 'hole_2', 'hole_t', 'flexi_bolt', 'flexi_hinge', 'bearing-clamp'])
const WHEEL_QDF = new Set(['multi-wheel2', 'floating-wheel2', 'casters2', 'steering-lock2', 'hub-cap2', 'bearing2', 'adapter2'])
const TEXTIL_QDF = new Set(['textil2', 'textil-round2', 'roof-large2', 'lattice2', 'bag2'])

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
  const { t } = useI18n()
  const { vw } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (k: string) => setOpen(o => (o === k ? null : k))
  const close = () => setOpen(null)

  useEffect(() => {
    const onEsc = () => close()
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [])

  const wheels = api.catalog.accessories.filter(a => a.qdf && ['multi-wheel2', 'floating-wheel2', 'casters2', 'steering-lock2', 'hub-cap2', 'bearing2', 'adapter2'].includes(a.qdf))
  const textiles = api.catalog.accessories.filter(a => a.qdf && ['textil2', 'textil-round2', 'roof-large2', 'lattice2', 'bag2'].includes(a.qdf))
  const pools = api.catalog.accessories.filter(a => a.id.startsWith('pool_liner'))
  const slides = [
    { id: 'slide-new2', part: 'slide_integral' },
    { id: 'slide2', part: 'slide_module' },
    { id: 'curved-slide2', part: 'slide_curved' },
    { id: 'slide-end2', part: 'slide_end' },
  ]
  const tubeDef = api.catalog.tubes.find(x => x.id === api.tubeId)
  const tubeCurved = api.catalog.curved.some(c => c.id === api.tubeId)
  const tubeMark = tubeCurved ? t('hint.curved') : (tubeDef ? String(tubeDef.length_cm) : '')
  const panelDef = api.catalog.panels.find(p => p.id === api.panelId)
  const panelMark = panelDef?.w && panelDef?.h ? `${panelDef.w}×${panelDef.h}` : ''

  return (
    <div
      className={`fixed z-50 flex flex-col items-stretch gap-1.5 pointer-events-none ${narrow ? 'left-2 right-2' : 'left-1/2 -translate-x-1/2 items-center'}`}
      style={{ top: TOP_MIN }}
    >
      <div className="flex items-stretch gap-1 bg-gray-950/90 backdrop-blur border border-gray-800 rounded-2xl p-1 shadow-xl pointer-events-auto max-w-full overflow-x-auto scrollbar-thin">
      <button disabled={!api.canUndo} onClick={api.undo} title={t('hint.undo')}
        className="flex items-center justify-center min-w-[2.5rem] h-12 px-2 rounded-xl text-gray-200 hover:bg-gray-800 disabled:opacity-30 cursor-pointer disabled:cursor-default">
        <Svg16 inner={TOOL_ICON.undo} />
      </button>
      <button disabled={!api.canRedo} onClick={api.redo} title={t('hint.redo')}
        className="flex items-center justify-center min-w-[2.5rem] h-12 px-2 rounded-xl text-gray-200 hover:bg-gray-800 disabled:opacity-30 cursor-pointer disabled:cursor-default">
        <Svg16 inner={TOOL_ICON.redo} />
      </button>
      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <button className={btn(api.mode === 'select')} onClick={() => { api.setMode('select'); close() }}>
        <Svg16 inner={TOOL_ICON.select} />{t('tool.select')}
      </button>
      <button className={btn(api.mode === 'delete', 'red')} title={t('tool.deleteHint')}
        onClick={() => { api.setMode(api.mode === 'delete' ? 'select' : 'delete'); close() }}>
        <Svg16 inner={TOOL_ICON.delete} />{t('tool.delete')}
      </button>

      <ToolDrop
        open={open === 'tubes'}
        active={open === 'tubes' || (api.mode === 'add' && !api.placingConnector)}
        onClick={() => { api.setMode('add'); toggle('tubes') }}
        menu={(
          <>
            {api.catalog.tubes.map(tube => (
              <button key={tube.id} onClick={() => { api.setTube(tube.id); close() }}
                title={TUBE_HOTKEY[tube.id] ? t('hint.tubeKey', { n: tube.length_cm, k: TUBE_HOTKEY[tube.id] }) : undefined}
                className={`flex items-center gap-2 w-full text-xs rounded-lg px-2 py-1.5 text-left ${api.tubeId === tube.id ? 'bg-teal-500 text-white font-semibold' : 'text-gray-100 hover:bg-gray-700'}`}>
                <Svg16 inner={tubeIcon(tube.id, tube.length_cm)} size={18} />
                <span className="truncate">{t('hint.tubeName', { n: tube.length_cm })}</span>
              </button>
            ))}
            {api.catalog.curved.map(c => (
              <button key={c.id} onClick={() => { api.setTube(c.id); close() }}
                className={`flex items-center gap-2 w-full text-xs rounded-lg px-2 py-1.5 text-left ${api.tubeId === c.id ? 'bg-teal-500 text-white font-semibold' : 'text-gray-100 hover:bg-gray-700'}`}>
                <Svg16 inner={tubeIcon(c.id)} size={18} />
                <span className="truncate">{t('hint.curved')}</span>
              </button>
            ))}
          </>
        )}
      >
        <Svg16 inner={tubeIcon(api.tubeId, tubeDef?.length_cm)} />
        <span className="leading-none">{t('tool.tubes')}{tubeMark ? <span className="opacity-80"> {tubeMark}</span> : null}</span>
      </ToolDrop>

      <ToolDrop
        open={open === 'panels'}
        active={open === 'panels' || api.mode === 'panel'}
        onClick={() => { api.setMode('panel'); toggle('panels') }}
        menu={(
          <div className="grid grid-cols-2 gap-1">
            {api.catalog.panels.map(p => (
              <button key={p.id} onClick={() => { api.setPanel(p.id); close() }}
                className={`flex items-center gap-1.5 text-xs rounded-lg border px-2 py-1.5 text-left ${api.panelId === p.id ? 'bg-teal-600 border-teal-400 text-white' : 'border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400'}`}>
                <Svg16 inner={partIcon(p.id, 'panels')} size={16} />
                <span className="truncate">{p.w && p.h ? `${p.w}×${p.h}` : labelOf(p.id, p.name)}</span>
              </button>
            ))}
          </div>
        )}
      >
        <Svg16 inner={TOOL_ICON.panel} />
        <span className="leading-none">{t('tool.panels')}{panelMark ? <span className="opacity-80"> {panelMark}</span> : null}</span>
      </ToolDrop>

      <ToolDrop
        open={open === 'conn'}
        active={open === 'conn' || api.mode === 'c45' || api.mode === 'clamp' || !!api.placingConnector || (api.mode === 'fitting' && JOINT_FITTING.has(api.fittingKind))}
        onClick={() => toggle('conn')}
        menu={(
          <div className="max-h-[70vh] overflow-y-auto pr-0.5 scrollbar-thin">
            {CONN_KIND_ORDER.map(kind => {
              const items = api.catalog.connectors.filter(c => c.kind === kind)
              if (!items.length) return null
              return (
                <div key={kind} className="mb-2 last:mb-0">
                  <div className="text-[10px] uppercase tracking-wider text-gray-300 mb-1">{connKindLabel(kind)}</div>
                  <div className="grid grid-cols-1 gap-1">
                    {items.map(c => (
                      <button key={c.id} onClick={() => { pickJoint(c.id, api); close() }}
                        className={`flex items-center gap-2 text-sm rounded-lg border px-2 py-1.5 text-left ${jointActive(c.id, api) ? 'bg-teal-600 border-teal-400 text-white' : 'border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400'}`}>
                        <Svg16 inner={CONN_CAT_ICON[c.id] ?? CONN_CAT_ICON['6way']} size={20} />
                        <span className="flex-1">{labelOf(c.id, c.name)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      >
        <Svg16 inner={CONN_CAT_ICON['6way']} />{t('tool.connections')}
      </ToolDrop>

      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <ToolDrop
        open={open === 'wheels'}
        active={open === 'wheels' || (api.mode === 'fitting' && WHEEL_QDF.has(api.fittingKind))}
        onClick={() => toggle('wheels')}
        menu={wheels.map(a => (
          <button key={a.id} onClick={() => { if (a.qdf) api.setFitting(a.qdf); close() }}
            className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
            <Svg16 inner={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.wheel} size={20} />{labelOf(a.id, a.name)}
          </button>
        ))}
      >
        <Svg16 inner={TOOL_ICON.wheel} />{t('tool.wheels')}
      </ToolDrop>
      <ToolDrop
        open={open === 'textiles'}
        active={open === 'textiles' || (api.mode === 'fitting' && TEXTIL_QDF.has(api.fittingKind))}
        onClick={() => toggle('textiles')}
        menu={textiles.map(a => (
          <button key={a.id} onClick={() => { if (a.qdf) api.setFitting(a.qdf); close() }}
            className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
            <Svg16 inner={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.textile} size={20} />{labelOf(a.id, a.name)}
          </button>
        ))}
      >
        <Svg16 inner={TOOL_ICON.textile} />{t('tool.textiles')}
      </ToolDrop>
      <ToolDrop
        open={open === 'pools'}
        active={open === 'pools'}
        onClick={() => toggle('pools')}
        menu={pools.map(a => (
          <button key={a.id} onClick={() => { api.startPool(a.id); close() }}
            className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
            <Svg16 inner={TOOL_ICON.pool} size={20} />{labelOf(a.id, a.name)}
          </button>
        ))}
      >
        <Svg16 inner={TOOL_ICON.pool} />{t('tool.pools')}
      </ToolDrop>
      <ToolDrop
        open={open === 'slides'}
        active={open === 'slides' || api.mode === 'slide'}
        onClick={() => toggle('slides')}
        menu={(
          <div className="grid grid-cols-1 gap-1">
            {slides.map(s => (
              <button key={s.id} onClick={() => { api.setSlide(s.id); close() }}
                className={`flex items-center gap-2 text-sm rounded-lg border px-2 py-1.5 text-left ${api.slideKind === s.id && api.mode === 'slide' ? 'bg-teal-600 border-teal-400 text-white' : 'border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400'}`}>
                <Svg16 inner={TOOL_ICON.slide} size={16} />{labelOf(s.part)}
              </button>
            ))}
          </div>
        )}
      >
        <Svg16 inner={TOOL_ICON.slide} />{t('tool.slides')}
      </ToolDrop>

      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <button className={btn(api.mode === 'reinforce')} title={t('tool.reinforceHint')} onClick={() => { api.startReinforce(); close() }}>
        <Svg16 inner={TOOL_ICON.reinforce} />{t('tool.reinforce')}
      </button>
      </div>
    </div>
  )
}
