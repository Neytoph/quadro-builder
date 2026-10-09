import { useI18n } from '../i18n'
import { useEngine } from '../store/EngineContext'
import { installationActive, selectInstallation, type CatalogueChoice, type CatalogueTool } from '../store/installationCatalogue'
import { isNewComponent } from '../store/newComponentStatus'
import { PartImg } from './icons'
import { installationCatalogueStrings } from './installationCatalogueStrings'
import CatalogueSourceSwitch, { type CatalogueSource } from './CatalogueSourceSwitch'
import './installationCatalogue.css'

export default function InstallationCatalogueMenu({ tool, entries, source, onSourceChange, onClose }: {
  tool: CatalogueTool
  entries: CatalogueChoice[]
  source: CatalogueSource
  onSourceChange: (source: CatalogueSource) => void
  onClose: () => void
}) {
  const api = useEngine()
  const { lang } = useI18n()
  const copy = installationCatalogueStrings[lang]
  const text = (key: string) => copy[key as keyof typeof copy] || key
  const toolEntries = entries.filter(entry => entry.tool === tool)
  const counts = {
    official: toolEntries.filter(entry => entry.origin === 'official').length,
    extended: toolEntries.filter(entry => entry.origin === 'extended').length,
  }
  const availableSource = counts.official > 0 ? 'official' : 'extended'
  const visibleSource = counts[source] > 0 ? source : availableSource
  const sourceEntries = toolEntries.filter(entry => entry.origin === visibleSource)
  const shortName = (name: string) => name.replace(/\s*[（(](?:兼容件?|compatible|kompatibel)[）)]/gi, '').replace(/\s*cm\b/g, '').trim()
  return <div className="ic-menu" data-ui="installation-catalogue" data-catalogue-tool={tool} lang={lang}>
    <CatalogueSourceSwitch source={visibleSource} counts={counts} onChange={onSourceChange} />
    <div className="ic-grid">
      {sourceEntries.map(entry => <button type="button" className="ic-part" key={entry.id} data-ui="catalogue-item" data-part-id={entry.id} data-category={entry.group} data-source={entry.origin} data-method={entry.method} data-new={isNewComponent(entry.id)} aria-pressed={installationActive(entry, api)} aria-label={`${isNewComponent(entry.id) ? copy.newComponent + ' · ' : ''}${entry.choice.label}`} title={`${isNewComponent(entry.id) ? copy.newComponent + ' · ' : ''}${entry.choice.label} · ${text(entry.method)} · ${copy[entry.origin]}`} disabled={api.readOnly} onClick={() => { if (selectInstallation(entry, api)) onClose() }}>
        {isNewComponent(entry.id) && <span className="ic-new" data-ui="catalogue-new" aria-label={copy.newComponent}>{copy.newBadge}</span>}
        <PartImg id={entry.id} svg={entry.choice.icon} size={64} /><span className="ic-name">{shortName(entry.choice.label)}</span>
      </button>)}
    </div>
    {!sourceEntries.length && <p className="ic-empty" role="status">{copy.empty}</p>}
  </div>
}
