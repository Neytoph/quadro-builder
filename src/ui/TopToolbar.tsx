import { useEffect, useState, type ReactNode } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { CONN_KIND_ORDER, connKindLabel, labelOf } from '../names'
import { ACC_CAT_ICON, CONN_CAT_ICON, Svg16, TOOL_ICON } from './icons'
import { UI_ESCAPE_EVENT } from './events'
import { TOP_MIN } from './panelLayout'

const TUBE_HOTKEY: Record<string, string> = { T15: '1', T25: '2', T35: '3', T10: '4', T20: '5', T75: '6' }

const STATUS_KEY: Record<string, string> = {
  select: 'status.select',
  delete: 'status.delete',
  add: 'status.add',
  panel: 'status.panel',
  slide: 'status.slide',
  fitting: 'status.fitting',
  clamp: 'status.clamp',
  c45: 'status.c45',
  reinforce: 'status.reinforce',
  assembly: 'status.assembly',
}

const PLACE_PREFIX = new Set(['add', 'panel', 'slide', 'fitting', 'clamp', 'c45', 'reinforce'])

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

function Pop({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-full left-0 mt-1.5 z-[60] pointer-events-auto bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-2 min-w-[13rem]">
      {children}
    </div>
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
    <div className="fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1.5 pointer-events-none" style={{ top: TOP_MIN }}>
      <div className="flex items-stretch gap-1 bg-gray-950/90 backdrop-blur border border-gray-800 rounded-2xl p-1 shadow-xl pointer-events-auto">
      <button disabled={!api.canUndo} onClick={api.undo} title={t('hint.undo')}
        className="px-2 rounded-xl text-base text-gray-200 hover:bg-gray-800 disabled:opacity-30 cursor-pointer">↶</button>
      <button disabled={!api.canRedo} onClick={api.redo} title={t('hint.redo')}
        className="px-2 rounded-xl text-base text-gray-200 hover:bg-gray-800 disabled:opacity-30 cursor-pointer">↷</button>
      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <button className={btn(api.mode === 'select')} onClick={() => { api.setMode('select'); close() }}>
        <Svg16 inner={TOOL_ICON.select} />{t('tool.select')}
      </button>
      <button className={btn(api.mode === 'delete', 'red')} title={t('tool.deleteHint')}
        onClick={() => { api.setMode(api.mode === 'delete' ? 'select' : 'delete'); close() }}>
        <Svg16 inner={TOOL_ICON.delete} />{t('tool.delete')}
      </button>

      <div className="relative">
        <button className={btn(open === 'tubes' || (api.mode === 'add' && !api.placingConnector))} onClick={() => { api.setMode('add'); toggle('tubes') }}>
          <Svg16 inner={TOOL_ICON.tube} />
          <span className="leading-none">{t('tool.tubes')}{tubeMark ? <span className="opacity-80"> {tubeMark}</span> : null}</span>
        </button>
        {open === 'tubes' && (
          <Pop>
            <div className="text-[10px] uppercase tracking-wider text-gray-300 mb-1.5">{t('section.tubeLength')}</div>
            <div className="flex gap-1.5 mb-2">
              {api.catalog.tubes.map(tube => (
                <button key={tube.id} onClick={() => { api.setTube(tube.id); close() }}
                  title={TUBE_HOTKEY[tube.id] ? t('hint.tubeKey', { n: tube.length_cm, k: TUBE_HOTKEY[tube.id] }) : undefined}
                  className={`flex-1 text-xs rounded-lg py-1.5 border ${api.tubeId === tube.id ? 'bg-teal-500 text-white border-teal-400 font-semibold' : 'bg-gray-800 border-gray-700 text-gray-200 hover:border-teal-400'}`}>
                  {tube.length_cm}
                </button>
              ))}
            </div>
            {api.catalog.curved.map(c => (
              <button key={c.id} onClick={() => { api.setTube(c.id); close() }}
                className={`w-full text-xs rounded-lg py-1.5 border ${api.tubeId === c.id ? 'bg-teal-500 text-white border-teal-400 font-semibold' : 'border-gray-700 bg-gray-800 text-gray-200 hover:border-teal-400'}`}>
                {t('hint.curved')}
              </button>
            ))}
          </Pop>
        )}
      </div>

      <div className="relative">
        <button className={btn(open === 'panels' || api.mode === 'panel')} onClick={() => { api.setMode('panel'); toggle('panels') }}>
          <Svg16 inner={TOOL_ICON.panel} />
          <span className="leading-none">{t('tool.panels')}{panelMark ? <span className="opacity-80"> {panelMark}</span> : null}</span>
        </button>
        {open === 'panels' && (
          <Pop>
            <div className="grid grid-cols-2 gap-1">
              {api.catalog.panels.map(p => (
                <button key={p.id} onClick={() => { api.setPanel(p.id); close() }}
                  className={`flex items-center gap-1.5 text-xs rounded-lg border px-2 py-1.5 text-left ${api.panelId === p.id ? 'bg-teal-600 border-teal-400 text-white' : 'border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400'}`}>
                  <Svg16 inner={TOOL_ICON.panel} size={16} />
                  <span className="truncate">{p.w && p.h ? `${p.w}×${p.h}` : labelOf(p.id, p.name)}</span>
                </button>
              ))}
            </div>
          </Pop>
        )}
      </div>

      <div className="relative">
        <button className={btn(open === 'conn' || api.mode === 'c45' || api.mode === 'clamp' || !!api.placingConnector || (api.mode === 'fitting' && JOINT_FITTING.has(api.fittingKind)))} onClick={() => toggle('conn')}>
          <Svg16 inner={CONN_CAT_ICON['6way']} />{t('tool.connections')}
        </button>
        {open === 'conn' && (
          <Pop>
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
          </Pop>
        )}
      </div>

      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <div className="relative">
        <button className={btn(open === 'wheels' || (api.mode === 'fitting' && WHEEL_QDF.has(api.fittingKind)))} onClick={() => toggle('wheels')}><Svg16 inner={TOOL_ICON.wheel} />{t('tool.wheels')}</button>
        {open === 'wheels' && (
          <Pop>
            {wheels.map(a => (
              <button key={a.id} onClick={() => { if (a.qdf) api.setFitting(a.qdf); close() }}
                className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
                <Svg16 inner={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.wheel} size={20} />{labelOf(a.id, a.name)}
              </button>
            ))}
          </Pop>
        )}
      </div>
      <div className="relative">
        <button className={btn(open === 'textiles' || (api.mode === 'fitting' && TEXTIL_QDF.has(api.fittingKind)))} onClick={() => toggle('textiles')}><Svg16 inner={TOOL_ICON.textile} />{t('tool.textiles')}</button>
        {open === 'textiles' && (
          <Pop>
            {textiles.map(a => (
              <button key={a.id} onClick={() => { if (a.qdf) api.setFitting(a.qdf); close() }}
                className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
                <Svg16 inner={(a.qdf && ACC_CAT_ICON[a.qdf]) || TOOL_ICON.textile} size={20} />{labelOf(a.id, a.name)}
              </button>
            ))}
          </Pop>
        )}
      </div>
      <div className="relative">
        <button className={btn(open === 'pools')} onClick={() => toggle('pools')}><Svg16 inner={TOOL_ICON.pool} />{t('tool.pools')}</button>
        {open === 'pools' && (
          <Pop>
            {pools.map(a => (
              <button key={a.id} onClick={() => { api.startPool(a.id); close() }}
                className="flex w-full items-center gap-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400 px-2 py-1.5 text-left mb-1 last:mb-0">
                <Svg16 inner={TOOL_ICON.pool} size={20} />{labelOf(a.id, a.name)}
              </button>
            ))}
          </Pop>
        )}
      </div>
      <div className="relative">
        <button className={btn(open === 'slides' || api.mode === 'slide')} onClick={() => toggle('slides')}>
          <Svg16 inner={TOOL_ICON.slide} />{t('tool.slides')}
        </button>
        {open === 'slides' && (
          <Pop>
            <div className="grid grid-cols-1 gap-1">
              {slides.map(s => (
                <button key={s.id} onClick={() => { api.setSlide(s.id); close() }}
                  className={`flex items-center gap-2 text-sm rounded-lg border px-2 py-1.5 text-left ${api.slideKind === s.id && api.mode === 'slide' ? 'bg-teal-600 border-teal-400 text-white' : 'border-gray-600 bg-gray-700 text-gray-50 hover:bg-teal-600 hover:border-teal-400'}`}>
                  <Svg16 inner={TOOL_ICON.slide} size={16} />{labelOf(s.part)}
                </button>
              ))}
            </div>
          </Pop>
        )}
      </div>

      <div className="w-px bg-gray-700 mx-0.5 self-stretch" />

      <button className={btn(api.mode === 'reinforce')} title={t('tool.reinforceHint')} onClick={() => { api.startReinforce(); close() }}>
        <Svg16 inner={TOOL_ICON.reinforce} />{t('tool.reinforce')}
      </button>
      </div>
      {open === null && <StatusHint />}
    </div>
  )
}

function StatusHint() {
  const { mode, placingConnector, pasting, pasteHeightCm } = useEngine()
  const { t } = useI18n()
  if (pasting) {
    return (
      <div data-ui="status-hint" className="pointer-events-none bg-gray-950/85 border border-teal-500/50 text-teal-50 text-xs px-3 py-1.5 rounded-lg backdrop-blur max-w-[min(36rem,48vw)] text-center leading-snug">
        {t('lib.placing')} · {t('status.paste', { h: pasteHeightCm ?? 0 })}
      </div>
    )
  }
  const key = placingConnector ? 'status.placeConnector' : (STATUS_KEY[mode] || 'status.select')
  const prefix = placingConnector || PLACE_PREFIX.has(mode)
  const danger = mode === 'delete'
  return (
    <div data-ui="status-hint" className={`pointer-events-none bg-gray-950/85 border text-xs px-3 py-1.5 rounded-lg backdrop-blur max-w-[min(32rem,42vw)] text-center leading-snug ${
      danger ? 'border-red-500/50 text-red-50' : 'border-teal-500/50 text-teal-50'
    }`}>
      {prefix ? `${t('lib.placing')} · ${t(key)}` : t(key)}
    </div>
  )
}
