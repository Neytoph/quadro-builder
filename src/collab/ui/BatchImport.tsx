import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { docs, partForFitting, partName } from '../../engine-api'
import { syncConfigured, syncNow } from '../../sync/bootstrap'
import { useCollab } from '../CollabContext'
import { importOne, isQdfFile, MAX_IMPORT, type ImportResult } from '../batchImport'
import { publishEnabled, publishPage } from '../../publish'
import { useSignedIn } from './bits'
import { Modal } from './Modals'

function label(qdfName: string) {
  return String(partName(partForFitting(qdfName)) || qdfName)
}

type Row = ImportResult & { thumb: string | null }

/**
 * 批量导入官方软件的 .qdf：一次拖进来多个，每个文件存成一座造型，放进「我的设计」。
 * 结果一个文件一张卡：缩略图、件数、导入不了的零件；「发到广场」打开发布页确认再发。
 */
export default function BatchImport({ onClose }: { onClose: () => void }) {
  const api = useEngine()
  const collab = useCollab()
  const signedIn = useSignedIn()
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<{ k: number; n: number } | null>(null)
  const [over, setOver] = useState(0)
  const [dropping, setDropping] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const publish = collab.enabled && signedIn && publishEnabled()

  const run = async (list: File[]) => {
    const files = list.filter(isQdfFile).slice(0, MAX_IMPORT)
    if (!files.length) { api.notify(t('batch.noQdf'), 'warn'); return }
    if (list.filter(isQdfFile).length > MAX_IMPORT) api.notify(t('batch.tooMany', { n: MAX_IMPORT }), 'warn')
    setDropping(false)
    setBusy({ k: 0, n: files.length })
    for (let i = 0; i < files.length; i++) {
      setBusy({ k: i + 1, n: files.length })
      const r = await importOne(files[i])
      const thumb = r.data ? await api.captureThumb({ kind: 'model', data: r.data }) : null
      // 这张缩略图就是「我的设计」和广场上这一座的封面，跟着下一次同步交上去；开源本地版没有同步，不记
      if (thumb && syncConfigured()) await docs.setDocCover(r.docId!, thumb)
      setRows(list => [...list, { ...r, thumb }])
    }
    setBusy(null)
    void syncNow()
  }

  const toPlaza = async (docId: string) => {
    if (!await api.pushDoc(docId)) { api.notify(t('saves.shareNotYet'), 'warn'); return }
    window.open(publishPage(lang, docId), '_blank', 'noopener')
  }

  const ok = rows.filter(r => r.ok).length
  const bad = rows.length - ok
  const title = rows.length ? (bad ? t('batch.resultBad', { ok, bad }) : t('batch.result', { ok })) : t('batch.title')

  return (
    <Modal onClose={() => { if (!busy) onClose() }} label={title} className="cb-import">
      <div data-ui="batch-import">
        <h3>{title}</h3>
        {!rows.length && <p className="s">{t('batch.body')}</p>}
        {(dropping || busy) && (
          <button type="button" className={`cb-drop ${over ? 'over' : ''}`} data-ui="batch-drop" disabled={!!busy}
            onClick={() => input.current?.click()}
            onDragOver={e => { e.preventDefault(); setOver(e.dataTransfer.items.length || 1) }}
            onDragLeave={() => setOver(0)}
            onDrop={e => { e.preventDefault(); setOver(0); void run([...e.dataTransfer.files]) }}>
            <Upload />
            <b>{busy ? t('batch.progress', { k: busy.k, n: busy.n }) : over ? t('batch.release', { n: over }) : t('batch.drop')}</b>
            <span>{t('batch.dropHint', { n: MAX_IMPORT })}</span>
            {busy && <span className="cb-prog" style={{ width: '100%' }}><i style={{ width: `${Math.round(busy.k / busy.n * 100)}%` }} /></span>}
          </button>
        )}
        {rows.length > 0 && (
          <div className="cb-files" data-ui="batch-results">
            {rows.map((r, i) => r.ok ? (
              <div key={i} className="cb-file" data-ui="batch-row" data-ok="true">
                {r.thumb ? <img src={r.thumb} alt="" /> : <span className="ph" />}
                <div>
                  <div className="fn">{r.file} <span className="cb-ok">✓ {t('collab.parts', { n: r.parts })}</span></div>
                  <div className="ttl">{r.name}</div>
                  {r.skipped.length > 0 && (
                    <div className="cb-miss"><b>{t('batch.skippedN', { n: r.skipped.reduce((s, x) => s + x.count, 0) })}</b>
                      {r.skipped.map(s => `${label(s.name)} ×${s.count}`).join(t('batch.sep'))}{t('batch.skippedRest')}</div>
                  )}
                  <div className="acts">
                    <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => { void api.openDoc(r.docId!); onClose() }}>{t('saves.open')}</button>
                    {publish && <button type="button" className="qb-btn qb-btn-sm" onClick={() => { void toPlaza(r.docId!) }} data-ui="batch-publish">{t('batch.toPlaza')}</button>}
                  </div>
                </div>
              </div>
            ) : (
              <div key={i} className="cb-file bad" data-ui="batch-row" data-ok="false">
                <div>
                  <div className="fn">{r.file} <span className="cb-bad">✗ {t('batch.unreadable')}</span></div>
                  <div className="cb-miss bad">{r.error === 'noParts' ? t('batch.noParts') : t('batch.failed', { err: r.error || '' })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {rows.length > 0 && <div className="cb-sum">{t('batch.saved', { n: ok })}</div>}
        <div className="foot">
          {rows.length > 0 && !dropping && !busy && <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => setDropping(true)}>{t('batch.more')}</button>}
          <button type="button" className="qb-btn qb-btn-sm" disabled={!!busy} onClick={onClose}>{t(rows.length ? 'collab.done' : 'batch.close')}</button>
        </div>
        <input ref={input} type="file" accept=".qdf" multiple hidden onChange={e => { void run([...(e.target.files || [])]); e.target.value = '' }} />
      </div>
    </Modal>
  )
}
