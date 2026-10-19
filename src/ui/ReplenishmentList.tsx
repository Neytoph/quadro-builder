import { useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { replenishmentCsv, replenishmentRows, replenishmentText } from './replenishment'
import PartThumbnail from './PartThumbnail'

export default function ReplenishmentList({ showRows = true }: { showRows?: boolean }) {
  const api = useEngine()
  const { t } = useI18n()
  const [copying, setCopying] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const missing = replenishmentRows(api.invRows, api.bom)
  const name = api.tabs.find(tab => tab.tabId === api.activeTabId)?.name || t('tab.untitled')
  const text = replenishmentText(api.invRows, name, t, api.bom)

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([replenishmentCsv(api.invRows, name, t, api.bom)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${name} ${t('replenish.title')}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const copy = async () => {
    if (busy.current) return
    busy.current = true
    setCopying(true)
    setFailed(false)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      api.notify(t('replenish.copied'))
    } catch (error) {
      console.warn('Replenishment clipboard write failed', error)
      setFailed(true)
      if (detailsRef.current) detailsRef.current.open = true
      textRef.current?.focus()
      textRef.current?.select()
    } finally {
      busy.current = false
      setCopying(false)
    }
  }

  if (api.feasible == null) return <p className="text-xs text-gray-500">{t('kit.noStock')}</p>

  return (
    <section data-ui="replenishment-list" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-gray-300">{t('replenish.title')}</h2>
        {missing.length > 0 && <span className="text-[11px] text-gray-500 tabular-nums">{t('replenish.total', { kinds: missing.length, pcs: missing.reduce((sum, row) => sum + row.short, 0) })}</span>}
      </div>
      {missing.length ? <>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={copying} aria-busy={copying} onClick={() => void copy()}
            className="qb-btn flex-1 min-h-11 flex items-center justify-center gap-2 text-xs font-semibold">
            <Copy size={15} aria-hidden="true" />{copying ? t('replenish.copying') : t('replenish.copy')}
          </button>
          <button type="button" onClick={exportCsv} aria-label={t('replenish.csvLabel')}
            className="qb-btn qb-btn-ghost qb-btn-sm">
            <Download size={15} aria-hidden="true" />{t('replenish.csv')}
          </button>
        </div>
        {failed && <p role="alert" className="text-xs text-rose-700">{t('replenish.failed')}</p>}
        {showRows && [false, true].map(soft => {
          const group = missing.filter(row => !!row.soft === soft)
          if (!group.length) return null
          return <div key={String(soft)} className="space-y-1">
            {soft && <p className="text-[11px] text-gray-500 pt-2">{t('replenish.optional')}</p>}
            {group.map(row => <div key={`${row.group}:${row.key}`} data-ui="replenishment-row" data-part-id={row.key} className="qb-material-row flex items-center gap-2">
              <PartThumbnail id={row.key} />
              <span className="qb-material-name text-gray-400 min-w-0 flex-1">{row.label}<span className="block text-[10px] text-gray-500 mt-0.5">{t('side.need')} {row.need} · {t('side.have')} {row.owned}</span></span>
              <span className="qb-material-count text-amber-700 tabular-nums">×{row.short}</span>
            </div>)}
          </div>
        })}
        <details ref={detailsRef}>
          <summary className="min-h-11 flex items-center text-xs text-gray-500 cursor-pointer">{t('replenish.view')}</summary>
          <textarea ref={textRef} readOnly value={text} aria-label={t('replenish.title')} rows={6}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-2 text-xs text-gray-100 leading-relaxed resize-y" />
        </details>
      </> : <p className="text-xs text-emerald-600">{t('replenish.enough')}</p>}
    </section>
  )
}
