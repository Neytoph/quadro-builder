import { useEffect, useState } from 'react'
import { RANDOM_COLOR, useEngine } from '../store/EngineContext'
import { LANGS, useI18n } from '../i18n'
import { colorLabel } from '../names'
import { CLASSIC_COLOR_IDS, HOME_COLOR_IDS, COLOR_HEX, PALETTES } from '../engine/colors.js'

const HEX = COLOR_HEX as Record<string, string>
import { MODULES, PRESETS } from '../data/presets'
import { PanelHandles, panelStyle, usePanelLayout } from './panelLayout'

function Swatch({ hex, selected, title, onClick }: {
  id: string
  hex: string
  selected: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button title={title} onClick={onClick}
      className={`w-7 h-7 rounded-md border-2 cursor-pointer transition-transform ${selected ? 'border-white scale-110' : 'border-gray-700'}`}
      style={{ background: hex }} />
  )
}

export default function SideToolbar() {
  const api = useEngine()
  const { t, lang, setLang } = useI18n()
  const { left } = usePanelLayout()
  const nameOf = (id: string) => colorLabel(id)

  return (
    <aside
      className="fixed z-30 flex flex-col overflow-hidden bg-gray-950/85 backdrop-blur border border-gray-800 rounded-2xl shadow-xl text-gray-200"
      style={panelStyle('left', left)}
    >
      <PanelHandles side="left" moveLabel={t('hint.movePanel')} sizeLabel={t('hint.resize')} />
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-left">
      <div className="scrollbar-left-content p-3 pb-5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{t('section.color')}</div>
      <div className="text-[10px] text-gray-500 mb-1">{t('section.classic')}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {CLASSIC_COLOR_IDS.map(id => (
          <Swatch key={id} id={id} hex={HEX[id]} selected={api.color === id}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
        <button title={t('hint.random')} onClick={() => api.setColor(RANDOM_COLOR)}
          className={`w-7 h-7 rounded-md border-2 cursor-pointer ${api.color === RANDOM_COLOR ? 'border-white scale-110' : 'border-gray-700'}`}
          style={{ background: 'conic-gradient(#e53e3e, #ecc94b, #38a169, #3182ce, #e53e3e)' }} />
      </div>

      <div className="text-[10px] text-gray-500 mb-1">{t('section.home')}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {HOME_COLOR_IDS.map(id => (
          <Swatch key={id} id={id} hex={HEX[id]} selected={api.color === id}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
      </div>

      <div className="pt-2 mt-1 border-t border-gray-800 mb-3">
        <div className="text-[10px] text-gray-500 mb-1.5">{t('section.recolor')}</div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {PALETTES.map(pal => (
            <button key={pal.key} title={t('hint.recolorFamily')}
              onClick={() => api.recolorAll(pal.colors)}
              className="flex items-center justify-center gap-1 text-[11px] rounded-md py-1.5 border border-gray-700 hover:border-white bg-gray-800 text-gray-200 cursor-pointer">
              <span className="w-3.5 h-3.5 rounded-full border border-black/20 shrink-0"
                style={{ background: `linear-gradient(90deg, ${pal.colors.join(',')})` }} />
              {t(`palette.${pal.key}`)}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-gray-500 mb-1">{t('section.recolorSame')}</div>
        <div className="flex flex-wrap gap-1.5">
          {[...CLASSIC_COLOR_IDS, ...HOME_COLOR_IDS].map(id => (
            <button key={id} title={`${t('hint.recolorSame')} · ${nameOf(id)}`}
              aria-label={`${t('hint.recolorSame')} · ${nameOf(id)}`}
              onClick={() => api.recolorAll([HEX[id]])}
              className="w-6 h-6 rounded border border-gray-700 hover:border-white cursor-pointer"
              style={{ background: HEX[id] }} />
          ))}
        </div>
      </div>

      <div className="mt-1 flex gap-1">
        {LANGS.map(item => (
          <button key={item.id} onClick={() => setLang(item.id)}
            className={`flex-1 text-xs rounded-lg py-1 border cursor-pointer ${lang === item.id ? 'bg-teal-500 text-white border-teal-400' : 'border-gray-700 bg-gray-800'}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-gray-800">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{t('section.modules')}</div>
        <div className="text-[10px] text-gray-500 mb-1.5 leading-snug">{t('hint.modules')}</div>
        <div className="flex flex-col gap-1">
          {MODULES.map(p => (
            <button key={p.key} onClick={() => api.placeModule(p.key)} title={p.hint}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 text-left cursor-pointer">
              {t(p.labelKey)} <span className="text-gray-500">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-gray-800">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{t('section.presets')}</div>
        <div className="flex flex-col gap-1">
          {PRESETS.map(p => (
            <button key={p.key}
              onClick={() => p.mode === 'replace' ? api.loadPreset(p.key) : api.placeModule(p.key)}
              title={p.mode === 'replace' ? t('hint.presetReplace') : p.hint}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 text-left cursor-pointer">
              {t(p.labelKey)} <span className="text-gray-500">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-gray-800">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{t('section.view')}</div>
        <div className="flex flex-col gap-1.5">
          <button onClick={api.toggleGrass} aria-pressed={api.grassOn}
            className={`text-xs rounded-lg border px-2 py-1.5 text-left cursor-pointer ${api.grassOn ? 'bg-emerald-500 text-white border-emerald-400 font-semibold' : 'border-gray-700 bg-gray-800 hover:border-teal-400'}`}>
            {t('btn.grass')}
          </button>
          <button onClick={api.frame} className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 text-left cursor-pointer">{t('btn.frame')}</button>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-2.5 mb-1.5">{t('section.room')}</div>
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer mb-1.5">
          <input type="checkbox" checked={api.room.visible} onChange={e => api.setRoom({ visible: e.target.checked })} className="accent-sky-500" />
          {t('room.show')}
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer mb-2">
          <input type="checkbox" checked={api.room.showExtents} onChange={e => api.setRoom({ showExtents: e.target.checked })} className="accent-sky-500" />
          {t('room.extents')}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          <CmField label={t('room.w')} value={api.room.w} onCommit={n => api.setRoom({ w: n })} />
          <CmField label={t('room.d')} value={api.room.d} onCommit={n => api.setRoom({ d: n })} />
          <CmField label={t('room.h')} value={api.room.h} onCommit={n => api.setRoom({ h: n })} />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {api.selectionCount > 0 && (
          <div className="text-[10px] text-gray-400">{t('section.selected', { n: api.selectionCount })}</div>
        )}
        <button onClick={api.selectAll}
          className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.selectAll')}</button>
        <button onClick={api.selectConnected} title={t('hint.selectBlock')}
          className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.selectBlock')}</button>
        <button disabled={api.selectionCount === 0} onClick={api.copy}
          className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer disabled:opacity-30">{t('btn.copy')}</button>
        <button disabled={!api.canPaste} onClick={api.paste}
          className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer disabled:opacity-30">{t('btn.paste')}</button>
        {api.selectionCount > 0 && (
          <>
            <button onClick={() => api.rotate(-1)} title={t('hint.rotate')}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.rotateBack')} Q</button>
            <button onClick={() => api.rotate(1)} title={t('hint.rotate')}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.rotate')} E</button>
            <button onClick={api.deleteSel} className="text-xs rounded-lg border border-red-900 bg-red-950/50 hover:border-red-400 px-2 py-1.5 cursor-pointer">{t('btn.delete')}</button>
          </>
        )}
      </div>
      </div>
      </div>
    </aside>
  )
}

function CmField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type="number"
        min={40}
        max={2000}
        value={txt}
        onChange={e => setTxt(e.target.value)}
        onBlur={() => onCommit(Number(txt))}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-xs tabular-nums outline-none focus:border-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}
