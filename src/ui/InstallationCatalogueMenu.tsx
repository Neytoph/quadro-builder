import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { useEngine } from '../store/EngineContext'
import { installationActive, selectInstallation, type CatalogueChoice, type CatalogueTool } from '../store/installationCatalogue'
import { CATALOGUE_TOOLS, TOOL_KEYS, TOOL_LABELS } from '../store/toolMemory'
import { PartImg, TOOL_ICON } from './icons'
import { installationCatalogueStrings } from './installationCatalogueStrings'
import { SLIDE_CARDS } from './SlideMenu'
import { NARROW_MAX, usePanelLayout } from './panelLayout'
import './installationCatalogue.css'

export default function InstallationCatalogueMenu({ tool, requestId, entries, onBrowse, onClose }: {
  tool: CatalogueTool
  requestId: number
  entries: CatalogueChoice[]
  onBrowse: (tool: CatalogueTool) => void
  onClose: () => void
}) {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { vw } = usePanelLayout()
  const imageSize = vw <= NARROW_MAX ? 48 : 64
  const copy = installationCatalogueStrings[lang]
  const methodName = (method: string) => copy[method as keyof typeof copy] || method
  const scroller = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const browsing = useRef(tool)
  const sections = CATALOGUE_TOOLS.filter(id => id === 'slides' ? SLIDE_CARDS.length > 0 : entries.some(entry => entry.tool === id))

  const locate = useCallback((target: CatalogueTool) => {
    const root = scroller.current
    const section = root?.querySelector<HTMLElement>(`[data-catalogue-section="${target}"]`)
    if (!root || !section) return false
    if (section === root.firstElementChild) root.scrollTop = 0
    else root.scrollTop += section.getBoundingClientRect().top - root.getBoundingClientRect().top
    browsing.current = target
    onBrowse(target)
    return true
  }, [onBrowse])

  useLayoutEffect(() => { locate(tool) }, [tool, requestId, locate])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const scroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const root = scroller.current
      if (!root) return
      const top = root.getBoundingClientRect().top + 24
      const groups = [...root.querySelectorAll<HTMLElement>('[data-catalogue-section]')]
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      const section = atEnd ? groups.at(-1) : groups.filter(section => section.getBoundingClientRect().top <= top).at(-1) || groups[0]
      const id = section?.dataset.catalogueSection as CatalogueTool | undefined
      if (id && browsing.current !== id) { browsing.current = id; onBrowse(id) }
    })
  }

  const shortName = (name: string) => name.replace(/\s*[（(](?:兼容件?|compatible|kompatibel)[）)]/gi, '').trim()
  return <div className="ic-menu ic-continuous" data-ui="installation-catalogue" lang={lang}>
    <div ref={scroller} className="ic-catalogue-scroll scrollbar-thin" data-ui="catalogue-scroll" onScroll={scroll}>
      {sections.map(id => <section key={id} data-catalogue-section={id} aria-label={t(TOOL_LABELS[id])}>
        <h2 className="ic-section-title"><span>{t(TOOL_LABELS[id])}</span><kbd>{TOOL_KEYS[id]}</kbd></h2>
        <div className="ic-grid">
          {id === 'slides' ? SLIDE_CARDS.map(card => <button key={card.id} type="button" className="ic-part" data-ui="catalogue-item" data-part-id={card.id} data-category="slides"
            aria-pressed={api.mode === 'slide' && api.slideKind === card.id} disabled={api.readOnly}
            title={`${t(card.family)}${card.size ? ` ${card.size} cm` : ''}`}
            onClick={() => { api.setSlide(card.id); onClose() }}>
            <PartImg id={card.image} svg={TOOL_ICON.slide} size={imageSize} />
            <span className="ic-name">{t(card.family)}{card.size && <><br />{card.size} cm</>}</span>
          </button>) : entries.filter(entry => entry.tool === id).map(entry => <button type="button" className="ic-part" key={entry.id} data-ui="catalogue-item" data-part-id={entry.id} data-category={entry.group} data-method={entry.method}
            aria-pressed={installationActive(entry, api)} aria-label={entry.choice.label} title={`${entry.choice.label} · ${methodName(entry.method)}`} disabled={api.readOnly}
            onClick={() => { if (selectInstallation(entry, api)) onClose() }}>
            <PartImg id={entry.id} svg={entry.choice.icon} size={imageSize} /><span className="ic-name">{shortName(entry.choice.label)}</span>
          </button>)}
        </div>
        {id === 'slides' && <p className="ic-section-note">{t('slide_separate_end_hint')}</p>}
      </section>)}
      {!sections.length && <p className="ic-empty" role="status">{copy.empty}</p>}
    </div>
  </div>
}
