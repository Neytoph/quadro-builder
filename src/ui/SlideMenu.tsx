import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { PartImg, TOOL_ICON } from './icons'
import CatalogueSourceSwitch, { type CatalogueSource } from './CatalogueSourceSwitch'
import './SlideMenu.css'

const FAMILIES = [
  { name: 'slide_group_integral', part: 'slide_integral', official: 'slide-new2', domestic: [
    { id: 'slide-domestic-integral60', size: '60×125', height: 60 },
    { id: 'slide-domestic-integral80', size: '80×145', height: 80 },
  ] },
  { name: 'slide_type_classic', part: 'slide_module', official: 'slide2', domestic: [
    { id: 'slide-domestic-classic60', size: '60×120', height: 60 },
    { id: 'slide-domestic-classic80', size: '80×160', height: 80 },
  ] },
  { name: 'slide_group_curved', part: 'slide_curved', official: 'curved-slide2', domestic: [
    { id: 'curved-slide-domestic80', size: '80×160', height: 80 },
  ] },
  { name: 'slide_type_end', part: 'slide_end', official: 'slide-end2', domestic: [] },
]

export const SLIDE_CARDS = FAMILIES.flatMap(family => [
  { id: family.official, size: '', height: undefined, family: family.name, image: family.part, origin: 'official' as const },
  ...family.domestic.map(part => ({ ...part, family: family.name, image: family.part, origin: 'extended' as const })),
])

const SOURCE_COUNTS = {
  official: FAMILIES.length,
  extended: FAMILIES.reduce((count, family) => count + Math.max(1, family.domestic.length), 0),
}

export function SlideCatalogue({ source, imageSize = 64, onClose }: {
  source?: CatalogueSource
  imageSize?: number
  onClose: () => void
}) {
  const api = useEngine()
  const { t } = useI18n()
  return <div className="qb-slide-families">
    {FAMILIES.map(family => {
      const cards = SLIDE_CARDS.filter(card => card.family === family.name &&
        (!source || card.origin === source || (source === 'extended' && family.domestic.length === 0)))
      return <div className="qb-slide-family" key={family.name} data-slide-family={family.name}>
        <h3 className="qb-slide-family-title">{t(family.name)}</h3>
        <div className="ic-grid">{cards.map(card => {
          let caption = t('slide_group_official')
          if (family.part === 'slide_end') caption = t('slide_shared_end')
          else if (card.origin === 'extended') caption = t('slide_height').replace('{height}', String(card.height))
          const label = `${t(family.name)} · ${caption}`
          const detail = card.size ? `${t('slide_dimensions')}: ${card.size}` : caption
          const needsEnd = family.part === 'slide_module' || family.part === 'slide_curved'
          return <button key={card.id} type="button" className="ic-part" data-ui="catalogue-item" data-part-id={card.id} data-category="slides" data-source={card.origin}
            aria-pressed={api.mode === 'slide' && api.slideKind === card.id} disabled={api.readOnly}
            aria-label={label} title={`${t(family.name)} · ${detail}${needsEnd ? ` · ${t('slide_separate_end_hint')}` : ''}`}
            onClick={() => { if (!api.readOnly) { api.setSlide(card.id); onClose() } }}>
            <PartImg id={card.image} svg={TOOL_ICON.slide} size={imageSize} />
            <span className="ic-name">{caption}</span>
          </button>
        })}</div>
      </div>
    })}
  </div>
}

export default function SlideMenu({ source, onSourceChange, onClose }: {
  source: CatalogueSource
  onSourceChange: (source: CatalogueSource) => void
  onClose: () => void
}) {
  const { lang } = useI18n()

  return (
    <div className="ic-menu qb-slide-menu" data-ui="installation-catalogue" data-catalogue-tool="slides" lang={lang}>
      <CatalogueSourceSwitch source={source} counts={SOURCE_COUNTS} onChange={onSourceChange} />
      <SlideCatalogue source={source} onClose={onClose} />
    </div>
  )
}
