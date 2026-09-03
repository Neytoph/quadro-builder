import { RANDOM_COLOR, useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { colorLabel } from '../names'
import { CLASSIC_COLOR_IDS, HOME_COLOR_IDS, COLOR_HEX, PALETTES } from '../engine/colors.js'
import { FoldHeader } from './panelLayout'

const HEX = COLOR_HEX as Record<string, string>

function Swatch({ hex, selected, title, onClick }: {
  hex: string
  selected: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button title={title} onClick={onClick}
      className={`w-7 h-7 rounded-md border-2 cursor-pointer transition-transform ${selected ? 'border-teal-600 scale-110' : 'border-gray-700'}`}
      style={{ background: hex }} />
  )
}

export default function SideToolbar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const api = useEngine()
  const { t } = useI18n()
  const nameOf = (id: string) => colorLabel(id)

  return (
    <div
      data-ui="color-panel"
      className="relative flex flex-col min-h-0 overflow-hidden bg-gray-950/85 backdrop-blur border border-gray-800 rounded-2xl shadow-xl text-gray-200"
    >
      <FoldHeader
        open={open}
        onToggle={onToggle}
        label={t('section.color')}
        title={open ? t('hint.hidePanel') : t('hint.showColor')}
      />
      {open && (
      <div className="p-3 overflow-y-auto min-h-0 scrollbar-thin">
      <div className="text-[10px] text-gray-500 mb-1">{t('section.classic')}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {CLASSIC_COLOR_IDS.map(id => (
          <Swatch key={id} hex={HEX[id]} selected={api.color === id}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
        <button title={t('hint.random')} onClick={() => api.setColor(RANDOM_COLOR)}
          className={`w-7 h-7 rounded-md border-2 cursor-pointer ${api.color === RANDOM_COLOR ? 'border-teal-600 scale-110' : 'border-gray-700'}`}
          style={{ background: 'conic-gradient(#F23B3B, #FFD942, #2FCB5A, #2B8FF0, #F23B3B)' }} />
      </div>

      <div className="text-[10px] text-gray-500 mb-1">{t('section.home')}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {HOME_COLOR_IDS.map(id => (
          <Swatch key={id} hex={HEX[id]} selected={api.color === id}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
      </div>

      <div className="pt-2 mt-1 border-t border-gray-800">
        <div className="text-[10px] text-gray-500 mb-1.5">{t('section.recolor')}</div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {PALETTES.map(pal => (
            <button key={pal.key} title={t('hint.recolorFamily')}
              onClick={() => api.recolorAll(pal.colors)}
              className="flex items-center justify-center gap-1 text-[11px] rounded-md py-1.5 border border-gray-700 hover:border-teal-400 bg-gray-800 text-gray-200 cursor-pointer">
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
              className="w-6 h-6 rounded border border-gray-700 hover:border-teal-400 cursor-pointer"
              style={{ background: HEX[id] }} />
          ))}
        </div>
      </div>
      </div>
      )}
    </div>
  )
}
