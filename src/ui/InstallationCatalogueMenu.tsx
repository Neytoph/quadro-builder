import { useState } from 'react'
import { useI18n } from '../i18n'
import { useEngine } from '../store/EngineContext'
import { installationActive, searchInstallation, selectInstallation, type CatalogueChoice, type CatalogueTool } from '../store/installationCatalogue'
import { isNewComponent } from '../store/newComponentStatus'
import { PartImg } from './icons'
import { installationCatalogueStrings } from './installationCatalogueStrings'
import './installationCatalogue.css'

const GROUPS: Record<CatalogueTool, string[]> = {
  panels: ['outside', 'inset'], accessories: ['on-tube', 'on-frame', 'auxiliary'], textiles: ['textile'], wheels: ['wheels'], slides: ['slides'], pools: ['pools'], tubes: ['tubes'], connectors: ['connectors'],
}
export default function InstallationCatalogueMenu({ tool, entries, onClose }: { tool: CatalogueTool; entries: CatalogueChoice[]; onClose: () => void }) {
  const api = useEngine()
  const { lang } = useI18n()
  const copy = installationCatalogueStrings[lang]
  const text = (key: string) => copy[key as keyof typeof copy] || key
  const [group, setGroup] = useState(GROUPS[tool][0])
  const [source, setSource] = useState('all')
  const [method, setMethod] = useState('all')
  const [query, setQuery] = useState('')
  const scope = entries.filter(entry => (query.trim() ? searchInstallation(entry, query) : entry.group === group) && (source === 'all' || entry.origin === source))
  const methods = [...new Set(scope.map(entry => entry.method))]
  const filtered = scope.filter(entry => method === 'all' || entry.method === method)
  const shortName = (name: string) => name.replace(/\s*[（(](?:兼容件?|compatible|kompatibel)[）)]/gi, '').replace(/\s*cm\b/g, '').trim()
  return <div className="ic-menu" data-ui="installation-catalogue" data-catalogue-tool={tool} lang={lang}>
    <input className="ic-search" type="search" value={query} placeholder={copy.search} aria-label={copy.search} data-ui="catalogue-search" onChange={event => { setQuery(event.target.value); setMethod('all') }} />
    <div className="ic-controls">
      <div className="ic-groups" aria-label={tool === 'panels' ? text('outside') + ' / ' + text('inset') : text(GROUPS[tool][0])}>
        {GROUPS[tool].map(id => <button type="button" key={id} data-ui="catalogue-category" data-category={id} aria-pressed={!query && group === id} onClick={() => { setGroup(id); setQuery(''); setMethod('all') }}>{text(id)} <small>{entries.filter(entry => entry.group === id).length}</small></button>)}
      </div>
      <select value={source} aria-label={copy.all} data-ui="catalogue-source" onChange={event => { setSource(event.target.value); setMethod('all') }}>
        <option value="all">{copy.all}</option><option value="official">{copy.official}</option><option value="extended">{copy.extended}</option>
      </select>
    </div>
    <div className="ic-meta">
      {methods.length > 1 ? <select value={method} aria-label={copy.methods} data-ui="catalogue-method" onChange={event => setMethod(event.target.value)}><option value="all">{copy.methods}</option>{methods.map(value => <option key={value} value={value}>{text(value)}</option>)}</select> : <span data-ui="catalogue-method-label">{methods[0] ? text(methods[0]) : ''}</span>}
      {source === 'all' && <span>{copy.legend}</span>}
      <span data-ui="catalogue-count">{filtered.length}</span>
    </div>
    <div className="ic-grid">
      {filtered.map(entry => <button type="button" className="ic-part" key={entry.id} data-ui="catalogue-item" data-part-id={entry.id} data-category={entry.group} data-source={entry.origin} data-method={entry.method} data-new={isNewComponent(entry.id)} aria-pressed={installationActive(entry, api)} aria-label={`${isNewComponent(entry.id) ? copy.newComponent + ' · ' : ''}${entry.choice.label}`} title={`${isNewComponent(entry.id) ? copy.newComponent + ' · ' : ''}${entry.choice.label} · ${text(entry.method)} · ${copy[entry.origin]}`} disabled={api.readOnly} onClick={() => { if (selectInstallation(entry, api)) onClose() }}>
        {isNewComponent(entry.id) && <span className="ic-new" data-ui="catalogue-new" aria-label={copy.newComponent}>{copy.newBadge}</span>}
        {source === 'all' && <span className="ic-origin" aria-label={copy[entry.origin]}>{entry.origin === 'official' ? 'Q' : '+'}</span>}
        <PartImg id={entry.id} svg={entry.choice.icon} size={64} /><span className="ic-name">{shortName(entry.choice.label)}</span>
      </button>)}
    </div>
    {!filtered.length && <p className="ic-empty" role="status">{copy.empty}</p>}
  </div>
}
