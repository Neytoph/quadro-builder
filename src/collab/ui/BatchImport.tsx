import { useState } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { partForFitting, partName } from '../../engine-api'
import { syncNow } from '../../sync/bootstrap'
import { importOne, isQdfFile, type ImportResult } from '../batchImport'

function label(qdfName: string) {
  return String(partName(partForFitting(qdfName)) || qdfName)
}

/**
 * 批量导入官方软件的 .qdf：拖进来或挑一批文件，每个文件存成一座造型。
 * 结果里列出每一座认不出的零件，设计师自己决定要不要在 builder 里补。
 */
export default function BatchImport({ onClose }: { onClose: () => void }) {
  const api = useEngine()
  const { t } = useI18n()
  const [results, setResults] = useState<ImportResult[]>([])
  const [busy, setBusy] = useState<{ k: number; n: number } | null>(null)
  const [over, setOver] = useState(false)

  const run = async (list: File[]) => {
    const files = list.filter(isQdfFile)
    if (!files.length) { api.notify(t('batch.noQdf'), 'warn'); return }
    setBusy({ k: 0, n: files.length })
    const out: ImportResult[] = []
    for (let i = 0; i < files.length; i++) {
      setBusy({ k: i + 1, n: files.length })
      out.push(await importOne(files[i]))
      setResults([...out])
    }
    setBusy(null)
    void syncNow()
    const ok = out.filter(r => r.ok).length
    api.notify(t('batch.done', { ok, n: out.length }), ok === out.length ? 'ok' : 'warn')
  }

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.qdf'
    input.multiple = true
    input.onchange = () => { void run([...(input.files || [])]) }
    input.click()
  }

  return (
    <div className="m-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4" onClick={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" className="m-modal qb-card w-full max-w-lg text-gray-100 p-5 max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={e => e.stopPropagation()} data-ui="batch-import">
        <div className="text-base font-semibold">{t('batch.title')}</div>
        <p className="text-sm text-gray-300 mt-1">{t('batch.body')}</p>
        <div
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]) }}
          className={`mt-3 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm ${over ? 'border-teal-500 bg-gray-900' : 'border-gray-700'}`}>
          <div className="text-gray-300">{t('batch.drop')}</div>
          <button type="button" disabled={!!busy} onClick={pick} className="qb-btn qb-btn-sm mt-2" data-ui="batch-pick">{t('batch.pick')}</button>
          {busy && <div className="text-xs text-gray-400 mt-2 qb-num">{t('batch.progress', { k: busy.k, n: busy.n })}</div>}
        </div>
        {results.length > 0 && (
          <div className="mt-3 flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5" data-ui="batch-results">
            {results.map((r, i) => (
              <div key={i} className="rounded-xl border border-gray-800 px-3 py-2" data-ui="batch-row" data-ok={r.ok}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${r.ok ? (r.skipped.length ? 'bg-amber-400' : 'bg-teal-400') : 'bg-red-500'}`} />
                  <span className="text-sm text-gray-100 truncate flex-1">{r.name}</span>
                  {r.ok && <span className="text-[11px] text-gray-400 qb-num">{t('batch.parts', { n: r.parts })}</span>}
                  {r.ok && r.docId && (
                    <button onClick={() => { void api.openDoc(r.docId!); onClose() }} className="text-xs text-teal-300 hover:text-teal-100 cursor-pointer">{t('saves.open')}</button>
                  )}
                </div>
                {!r.ok && <div className="text-[11px] text-red-400 mt-0.5">{t(r.error === 'noParts' ? 'batch.noParts' : 'batch.failed', { err: r.error || '' })}</div>}
                {r.skipped.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    {t('batch.skipped')}{r.skipped.map(s => `${label(s.name)} ×${s.count}`).join(t('batch.sep'))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button type="button" disabled={!!busy} onClick={onClose} className="qb-btn qb-btn-ghost qb-btn-sm">{t('batch.close')}</button>
        </div>
      </div>
    </div>
  )
}
