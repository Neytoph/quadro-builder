import { useEffect, useState } from 'react'
import { FileArchive, ArrowUpRight } from 'lucide-react'
import { confirmedSyncAccount } from '../sync/bootstrap'
import { listDeviceDrafts, readDeviceDraft, type DeviceDraft } from '../store/deviceDrafts'
import { useI18n } from '../i18n'
import { myModelsURL } from './MyModelsLink'
import './singleModel.css'

export default function DeviceDraftManager() {
  const { t, lang } = useI18n()
  const [owner, setOwner] = useState<string | null>(null), [ready, setReady] = useState(false)
  const [rows, setRows] = useState<DeviceDraft[]>([]), [legacy, setLegacy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  useEffect(()=>{document.documentElement.dataset.deviceDrafts='true';return()=>{delete document.documentElement.dataset.deviceDrafts}},[])
  useEffect(() => { let closed = false; void Promise.resolve(confirmedSyncAccount()).then(id => { if (!closed) { setOwner(id); setReady(true) } }, () => { if (!closed) { setError(t('single.failed')); setLoading(false) } }); return () => { closed = true } }, [t])
  useEffect(() => { if (!ready) return; let closed = false; setLoading(true); void listDeviceDrafts(owner, legacy).then(value => { if (!closed) { setRows(value); setError('') } }, () => { if (!closed) setError(t('single.failed')) }).finally(() => { if (!closed) setLoading(false) }); return () => { closed = true } }, [owner, ready, legacy, revision, t])
  const url = (row: DeviceDraft) => {
    const next = new URL('/builder/', location.origin)
    next.searchParams.set('draft', crypto.randomUUID()); next.searchParams.set('lang', lang); next.searchParams.set('recoverSource', row.reference)
    if (row.unassigned) next.searchParams.set('unassigned', '1')
    return next.href
  }
  const backup = async (row: DeviceDraft) => {
    const value = await readDeviceDraft(owner, row.reference, legacy), link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([value.text || JSON.stringify(value.data)], { type: value.text ? 'text/plain' : 'application/json' }))
    link.download = (value.name || t('tab.untitled')).replace(/[\\/:*?"<>|]/g, '_') + (value.text ? '.qdf' : '.json'); link.click(); URL.revokeObjectURL(link.href)
  }
  return <main className="device-drafts" data-ui="device-drafts">
    {window.parent===window && <header><FileArchive size={24} aria-hidden="true"/><h1>{t('single.drafts')}</h1></header>}
    <p>{t('single.cloudHint')} <a href={myModelsURL(lang)} target="_blank" rel="noopener">{t('models.open')} ↗</a></p>
    <p>{t('single.draftIntro')}</p>
    {loading && <p role="status">{t('single.loading')}</p>}
    {error && <p role="alert">{error}<button onClick={() => { if (!ready) location.reload(); else setRevision(value => value + 1) }}>{t('single.retry')}</button></p>}
    {!loading && !error && !rows.length && <p className="device-drafts-empty">{t('single.empty')}</p>}
    <ul>{rows.map(row => <li key={row.reference}><div><strong>{row.name || t('tab.untitled')}</strong><small>{t(row.unassigned ? 'single.unassigned' : 'single.local')} · {t('single.source.'+row.source)}{row.updatedAt > 0 ? ' · ' + new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(row.updatedAt) : ''}</small></div>
      <div className="device-draft-actions"><button onClick={() => void backup(row).catch(() => setError(t('single.failed')))}>{t('single.backup')}</button><a href={url(row)} target="_blank" rel="noopener">{t('single.restore')}<ArrowUpRight size={14}/></a></div></li>)}</ul>
    <button className="device-drafts-legacy" disabled={legacy || loading} onClick={() => { if (window.confirm(t('single.claim'))) setLegacy(true) }}>{t('single.legacy')}</button>
    <p className="device-drafts-note">{t('single.originals')}</p>
  </main>
}
