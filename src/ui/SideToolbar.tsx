import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { RANDOM_COLOR, useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { colorLabel } from '../names'
import { CLASSIC_COLOR_IDS, HOME_COLOR_IDS, COLOR_HEX, PALETTES } from '../engine/colors.js'
import { FoldHeader } from './panelLayout'
import { Collapse } from './MotionBits'
import { normalizeColor, customColorSlots } from '../engine/customColors.js'
import CustomColorPicker from './CustomColorPicker'
import { colorStrings } from './colorStrings'
import './CustomColors.css'

const HEX = COLOR_HEX as Record<string, string>
const RECOLOR_COLOR_IDS = [...CLASSIC_COLOR_IDS, ...HOME_COLOR_IDS]
const SLOTS_KEY = 'quadro.custom-color-slots.v1'

function loadSlots() {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SLOTS_KEY) || '[]')
    if (!Array.isArray(stored)) throw new Error('Invalid custom colour slots')
    return { colors: customColorSlots(stored) as Array<string | null>, error: false }
  } catch (error) {
    console.error('Custom colour slots could not be loaded', error)
    return { colors: customColorSlots([]) as Array<string | null>, error: true }
  }
}

function Swatch({ hex, selected, title, className = '', children, ...button }: ButtonHTMLAttributes<HTMLButtonElement> & {
  hex?: string
  selected?: boolean
}) {
  return <button {...button} type="button" title={title} aria-label={button['aria-label'] || title}
    aria-pressed={selected} className={`qb-color-swatch ${className}`}>
    <span style={hex ? { background: hex } : undefined}>{children}</span>
  </button>
}

export default function SideToolbar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const api = useEngine()
  const { t, lang } = useI18n()
  const s = colorStrings[lang]
  const [slots, setSlots] = useState(loadSlots)
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState<{ anchor: DOMRect; initial: string; slot: number } | null>(null)
  const finishRef = useRef(api.finishColorPreview)
  finishRef.current = api.finishColorPreview
  const current = normalizeColor(HEX[api.color] || api.color)
  const disabled = !api.ready || api.readOnly || api.mode === 'assembly'
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SLOTS_KEY || event.key === null) setSlots(loadSlots()) }
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('storage', sync); finishRef.current() }
  }, [])
  useEffect(() => {
    if (!open || disabled) { finishRef.current(); setPicker(null) }
  }, [open, disabled, api.activeTabId])
  useEffect(() => { if (!api.previewingColor) setPicker(null) }, [api.previewingColor])

  const saveSlot = (index: number, hex: string) => {
    const stored = loadSlots()
    const colors = (stored.error ? slots.colors : stored.colors).map((color, position) => position === index ? hex : color)
    try { localStorage.setItem(SLOTS_KEY, JSON.stringify(colors)); setSlots({ colors, error: false }) }
    catch (error) { console.error('Custom colour slots could not be saved', error); setSlots({ colors, error: true }) }
  }
  const nameOf = (id: string) => colorLabel(id)

  return (
    <div
      data-ui="color-panel"
      className="qb-card relative flex flex-col min-h-0 overflow-hidden text-gray-200"
    >
      <FoldHeader
        open={open}
        onToggle={onToggle}
        label={t('section.color')}
        title={open ? t('hint.hidePanel') : t('hint.showColor')}
      />
      <Collapse open={open}>
      <div className="qb-color-body overflow-y-auto min-h-0 scrollbar-thin">
      <section className="qb-color-group" aria-label={t('section.classic')}>
      <h3 className="qb-color-label">{t('section.classic')}</h3>
      <div className="qb-color-swatches">
        {CLASSIC_COLOR_IDS.map(id => (
          <Swatch key={id} hex={HEX[id]} selected={current === normalizeColor(HEX[id])} disabled={disabled}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
        <Swatch title={t('hint.random')} disabled={disabled} onClick={() => api.setColor(RANDOM_COLOR)} selected={api.color === RANDOM_COLOR}
          hex="conic-gradient(#F23B3B, #FFD942, #2FCB5A, #2B8FF0, #F23B3B)" />
      </div>
      </section>

      <section className="qb-color-group" aria-label={t('section.home')}>
      <h3 className="qb-color-label">{t('section.home')}</h3>
      <div className="qb-color-swatches">
        {HOME_COLOR_IDS.map(id => (
          <Swatch key={id} hex={HEX[id]} selected={current === normalizeColor(HEX[id])} disabled={disabled}
            title={nameOf(id)} onClick={() => api.setColor(id)} />
        ))}
      </div>
      </section>

      <section className="qb-color-group qb-color-section" aria-label={s.custom}>
        <div className="qb-color-slot-heading"><h3 className="qb-color-label">{s.custom}</h3>
          <button type="button" className="qb-color-edit" disabled={disabled} aria-label={editing ? s.done : s.edit} title={editing ? s.done : s.edit} aria-pressed={editing} onClick={() => setEditing(value => !value)}><Pencil size={12} aria-hidden="true" /><span>{editing ? s.done : s.edit}</span></button></div>
        <div className="qb-color-slots" data-ui="custom-color-slots">
          {slots.colors.map((hex, index) => <Swatch key={index} className="qb-color-slot" hex={hex || undefined}
            data-ui="custom-color-slot" data-slot={index} data-empty={!hex} data-editing={editing}
            disabled={disabled} selected={!!hex && current === hex}
            aria-label={`${s.custom} ${index + 1}${hex ? ` · ${hex}` : ` · ${s.empty}`}`}
            title={hex ? `${hex} · ${editing ? s.edit : s.use}` : s.empty}
            aria-haspopup={!hex || editing ? 'dialog' : undefined}
            onClick={event => {
              if (hex && !editing) { api.setColor(hex); return }
              const anchor = event.currentTarget.getBoundingClientRect()
              if (api.beginColorPreview()) setPicker({ anchor, slot: index, initial: hex || (api.mode === 'select' ? api.selectionColor : null) || current || '#E8AE7A' })
            }}>{hex ? editing && <Pencil size={12} strokeWidth={1.5} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}</Swatch>)}
        </div>
        {slots.error && <p role="status" className="qb-color-storage">{s.storage}</p>}
      </section>

      <section className="qb-color-group qb-color-section" aria-label={t('section.recolor')}>
        <h3 className="qb-color-label">{t('section.recolor')}</h3>
        <div className="qb-color-palettes">
          {PALETTES.map(pal => (
            <button key={pal.key} title={t('hint.recolorFamily')}
              disabled={disabled} onClick={() => api.recolorAll(pal.colors)} className="qb-color-palette">
              <span className="qb-color-palette-preview" aria-hidden="true">{pal.colors.map((hex, index) => <i key={index} style={{ background: hex }} />)}</span>
              <span>{t(`palette.${pal.key}`)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="qb-color-group" aria-label={s.all}>
        <h3 className="qb-color-label">{s.all}</h3>
        <div className="qb-color-swatches">
          {RECOLOR_COLOR_IDS.map(id => (
            <Swatch key={id} title={`${t('hint.recolorSame')} · ${nameOf(id)}`} disabled={disabled} hex={HEX[id]}
              onClick={() => api.recolorAll([HEX[id]])}
            />
          ))}
          {current && !RECOLOR_COLOR_IDS.some(id => normalizeColor(HEX[id]) === current) &&
            <Swatch hex={current} title={`${s.allHint} · ${current}`} data-ui="custom-color-all" disabled={disabled}
              onClick={() => api.recolorAll([current])} />}
        </div>
      </section>
      </div>
      </Collapse>
      {picker && api.previewingColor && <CustomColorPicker initial={picker.initial} anchor={picker.anchor}
        selected={api.mode === 'select' && api.selectionCount > 0} onPreview={api.previewColor}
        onFinish={hex => { const applied = api.finishColorPreview(hex); if (applied && hex) { saveSlot(picker.slot, hex); setEditing(false) } setPicker(null) }} />}
    </div>
  )
}
