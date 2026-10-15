import { useI18n } from '../i18n'
import type { CatalogueEntry } from '../store/installationCatalogue'
import { installationCatalogueStrings } from './installationCatalogueStrings'
import './installationCatalogue.css'

export type CatalogueSource = CatalogueEntry['origin']

export default function CatalogueSourceSwitch({ source, counts, onChange }: {
  source: CatalogueSource
  counts: Record<CatalogueSource, number>
  onChange: (source: CatalogueSource) => void
}) {
  const { lang } = useI18n()
  const copy = installationCatalogueStrings[lang]
  return <div className="ic-sources" role="group" aria-label={copy.source} data-ui="catalogue-source">
    {(['official', 'extended'] as const).filter(value => counts[value] > 0).map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => onChange(value)}>{copy[value]} <small>{counts[value]}</small></button>)}
  </div>
}
