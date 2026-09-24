import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import type { Metrics, VersionInfo } from '../api'

/**
 * 锁定交付：把一个版本锁成交付页。引擎算出的客观量只陈述，适龄和承重由设计师自己写。
 * 锁好以后给出交付页地址，复制出去的链接带来源标记。
 */
export default function DeliverDialog({ version, onClose }: { version: VersionInfo; onClose: () => void }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [ageNote, setAgeNote] = useState('')
  const [loadNote, setLoadNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    void collab.metricsOf(version.id).then(setMetrics).catch(err => api.notify(String(err instanceof Error ? err.message : err), 'err'))
  }, [collab, version.id, api])

  const url = token ? `${location.origin}/deliver.html?t=${encodeURIComponent(token)}&src=${encodeURIComponent(`delivery:${token}`)}` : ''

  const submit = async () => {
    if (!metrics || busy) return
    setBusy(true)
    try {
      setToken(await collab.deliver({ versionId: version.id, ageNote: ageNote.trim(), loadNote: loadNote.trim(), metrics }))
    } catch (err) {
      api.notify(String(err instanceof Error ? err.message : err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const cell = (label: string, value: string) => (
    <div className="rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-base font-semibold text-gray-100 qb-num">{value}</div>
    </div>
  )

  // 从右侧面板里打开：挂到 body 上，不然被面板框住
  return createPortal(
    <div className="m-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="m-modal qb-card w-full max-w-md text-gray-100 p-5 max-h-[calc(100vh-2rem)] overflow-y-auto"
        onClick={e => e.stopPropagation()} data-ui="deliver-dialog">
        <div className="text-base font-semibold">{t('collab.deliver.title')}</div>
        <p className="text-sm text-gray-300 mt-1">{t('collab.deliver.body', { name: version.name })}</p>
        {!token && (
          <>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 mt-4 mb-1.5">{t('collab.deliver.metrics')}</div>
            {metrics ? (
              <div className="grid grid-cols-2 gap-1.5" data-ui="deliver-metrics">
                {cell(t('collab.metrics.maxDeckHeight'), `${metrics.maxDeckHeight} cm`)}
                {cell(t('collab.metrics.maxSpan'), `${metrics.maxSpan} cm`)}
                {cell(t('collab.metrics.hasGuard'), t(metrics.hasGuard ? 'collab.metrics.yes' : 'collab.metrics.no'))}
                {cell(t('collab.metrics.footprint'), `${metrics.footprint} m²`)}
              </div>
            ) : <div className="text-xs text-gray-400">{t('collab.loading')}</div>}
            <p className="text-[11px] text-gray-400 mt-1.5">{t('collab.metrics.note')}</p>
            <label className="block mt-3">
              <span className="text-xs text-gray-400">{t('collab.deliver.ageNote')}</span>
              <textarea value={ageNote} onChange={e => setAgeNote(e.target.value)} rows={2} placeholder={t('collab.deliver.agePlaceholder')}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500" />
            </label>
            <label className="block mt-2">
              <span className="text-xs text-gray-400">{t('collab.deliver.loadNote')}</span>
              <textarea value={loadNote} onChange={e => setLoadNote(e.target.value)} rows={2} placeholder={t('collab.deliver.loadPlaceholder')}
                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500" />
            </label>
            <p className="text-[11px] text-gray-400 mt-2">{t('collab.deliver.lockNote')}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={onClose} className="qb-btn qb-btn-ghost qb-btn-sm">{t('confirm.cancel')}</button>
              <button type="button" disabled={!metrics || busy || !ageNote.trim() || !loadNote.trim()} onClick={() => void submit()} className="qb-btn qb-btn-sm" data-ui="deliver-submit">{t('collab.deliver.submit')}</button>
            </div>
          </>
        )}
        {token && (
          <div className="mt-4" data-ui="deliver-done">
            <div className="text-sm text-gray-100">{t('collab.deliver.done')}</div>
            <input readOnly value={url} className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs" onFocus={e => e.target.select()} />
            <div className="flex justify-end gap-2 mt-3">
              <a href={url} target="_blank" rel="noreferrer" className="qb-btn qb-btn-ghost qb-btn-sm no-underline">{t('collab.deliver.openPage')}</a>
              <button type="button" onClick={() => { void navigator.clipboard.writeText(url).then(() => api.notify(t('collab.linkCopied'))) }} className="qb-btn qb-btn-sm">{t('collab.copyLink')}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
