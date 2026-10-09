import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { PartImg, TOOL_ICON } from './icons'
import CatalogueSourceSwitch, { type CatalogueSource } from './CatalogueSourceSwitch'
import './SlideMenu.css'

const FAMILIES = [
  { name: 'slide_group_integral', part: 'slide_integral', official: 'slide-new2', domestic: [
    { id: 'slide-domestic-integral60', size: '60×125' },
    { id: 'slide-domestic-integral80', size: '80×145' },
  ] },
  { name: 'slide_type_classic', part: 'slide_module', official: 'slide2', domestic: [
    { id: 'slide-domestic-classic60', size: '60×120' },
    { id: 'slide-domestic-classic80', size: '80×160' },
  ] },
  { name: 'slide_group_curved', part: 'slide_curved', official: 'curved-slide2', domestic: [
    { id: 'curved-slide-domestic80', size: '80×160' },
  ] },
  { name: 'slide_type_end', part: 'slide_end', official: 'slide-end2', domestic: [] },
]

const SOURCE_COUNTS = {
  official: FAMILIES.length,
  extended: FAMILIES.reduce((count, family) => count + Math.max(1, family.domestic.length), 0),
}

export default function SlideMenu({ source, onSourceChange, onClose }: {
  source: CatalogueSource
  onSourceChange: (source: CatalogueSource) => void
  onClose: () => void
}) {
  const api = useEngine()
  const { t, lang } = useI18n()
  const pick = (id: string) => { if (!api.readOnly) { api.setSlide(id); onClose() } }
  const active = (id: string) => api.mode === 'slide' && api.slideKind === id
  const cards = FAMILIES.flatMap(family => {
    const variants = source === 'extended' && family.domestic.length > 0
      ? family.domestic : [{ id: family.official, size: '' }]
    return variants.map(part => ({ ...part, family }))
  })

  return (
    <div className="ic-menu qb-slide-menu" data-ui="installation-catalogue" data-catalogue-tool="slides" lang={lang}>
      <CatalogueSourceSwitch source={source} counts={SOURCE_COUNTS} onChange={onSourceChange} />
      <div className="ic-grid">
        {cards.map(({ id, size, family }) => <button key={id} type="button" className="ic-part" data-ui="catalogue-item" data-part-id={id} data-category="slides" data-source={source} aria-pressed={active(id)} disabled={api.readOnly} onClick={() => pick(id)} aria-label={`${t(family.name)}${size ? ` ${size} cm` : ''}`} title={`${t(family.name)}${size ? ` ${size} cm · ${t('slide_dimensions')}` : ''} · ${t('slide_separate_end_hint')}`}>
          <PartImg id={family.part} svg={TOOL_ICON.slide} size={64} />
          <span className="ic-name">{t(family.name)}{size && <><br />{size}</>}</span>
        </button>)}
      </div>
      <div className="qb-slide-foot">
        {source === 'extended' && <span>{t('slide_dimensions')} · </span>}
        {t('slide_separate_end_hint')}
      </div>
    </div>
  )
}
