import { useEffect, useRef, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { LANGS, useI18n } from '../i18n'
import { ONBOARDING_EVENT } from './Onboarding'
import { useCollab } from '../collab/CollabContext'
import BatchImport from '../collab/ui/BatchImport'
import { storage } from '../engine-api'
import { syncConfigured } from '../sync/bootstrap'
import { displaySaveState } from '../store/personalTabs'
import { legacyBackupWithTabs } from '../collab/legacyBackup'
import { Modal } from '../collab/ui/Modals'
import { Box, BookOpen, ChevronDown, FileJson, FolderInput, Image, Link, Plus, Save, Sparkles, Upload } from 'lucide-react'

const btn = 'qb-file-action'

export default function FilePanel() {
  const api = useEngine()
  const collab = useCollab()
  const { t, lang, setLang } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [batch, setBatch] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [legacy, setLegacy] = useState<Awaited<ReturnType<typeof legacyBackupWithTabs>> | null>(null)
  const legacyModels = legacy ? [
    ...(legacy.documents as Array<{ name: string; data: unknown }>),
    ...legacy.tabModels,
    ...legacy.namedDrafts,
    { name: t('tab.untitled'), data: legacy.autosave },
  ].filter(row => row.data && typeof row.data === 'object' && Array.isArray((row.data as { nodes?: unknown }).nodes)) : []
  // 共享方案随改随同步，没有「保存」；「另存为」存一份到自己的设计里
  const plan = collab.mode === 'plan'
  const active = api.tabs.find(tab => tab.tabId === api.activeTabId)

  return (
    <div className="qb-file-panel">
      <section aria-labelledby="qb-file-start">
        <h2 id="qb-file-start" className="qb-file-section">{t('chrome.start')}</h2>
        {!plan && active && <div role="status" data-ui="file-save-status" className="text-xs text-amber-800 px-2 pb-2 leading-relaxed">
          {t(`sync.${displaySaveState(active, active.dirty)}`)}
          {active.saveState === 'conflict' && active.conflictDocId && <button className="qb-file-row" onClick={() => void api.openDoc(active.conflictDocId!)}>{t('sync.viewLatest')}</button>}
          {active.saveState === 'failed' && <button className="qb-file-row" onClick={() => void api.retrySave(active.tabId)}>{t('sync.retry')}</button>}
        </div>}
        {!plan && <button onClick={() => void api.saveCurrent()} className={`${btn} qb-file-primary`}><Save aria-hidden="true" /><span>{t('chrome.save')}</span><kbd>{t('chrome.saveShortcut')}</kbd></button>}
        <div className="qb-file-two">
          <button onClick={() => { api.newTab(); api.notify(t('toast.newTab')) }} className={btn}><Plus aria-hidden="true" /><span>{t('btn.new')}</span></button>
          <button onClick={() => fileRef.current?.click()} className={btn}><Upload aria-hidden="true" /><span>{t('btn.import')}</span></button>
        </div>
        <button onClick={() => void api.saveCurrentAs()} className="qb-file-row"><Save aria-hidden="true" /><span>{t('chrome.saveAs')}</span><kbd>{t('chrome.saveAsShortcut')}</kbd></button>
        <button onClick={() => setBatch(true)} className="qb-file-row" data-ui="batch-open"><FolderInput aria-hidden="true" /><span>{t('batch.open')}<small>QDF</small></span></button>
        {syncConfigured() && <button disabled={backingUp} className="qb-file-row" onClick={() => {
          if (!window.confirm(t('saves.legacyBackupConfirm'))) return
          setBackingUp(true)
          void legacyBackupWithTabs().then(setLegacy)
            .catch(error => api.notify(String(error), 'err')).finally(() => setBackingUp(false))
        }}><FileJson aria-hidden="true" /><span>{t('saves.legacyBackup')}</span></button>}
        <input ref={fileRef} type="file" accept=".qdf,.json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void api.importFile(f); e.target.value = '' }} />
      </section>
      <section aria-labelledby="qb-file-exports" className="qb-file-separated">
        <h2 id="qb-file-exports" className="qb-file-section">{t('chrome.export')}</h2>
        <div className="qb-file-export-grid">
          <button onClick={api.exportPng} className="qb-file-export" title={t('btn.exportPng')}><Image aria-hidden="true" /><strong>{t('chrome.image')}</strong><small>{t('chrome.imageHint')}</small></button>
          <button onClick={api.exportJson} className="qb-file-export" title={t('btn.exportJson')}><FileJson aria-hidden="true" /><strong>{t('chrome.backup')}</strong><small>{t('chrome.backupHint')}</small></button>
          <button onClick={api.exportQdf} className="qb-file-export" title={t('btn.exportQdf')}><Box aria-hidden="true" /><strong>{t('chrome.original')}</strong><small>{t('chrome.originalHint')}</small></button>
          <button onClick={() => void api.exportAssemblyPdf()} disabled={!!api.exportingManual} aria-busy={!!api.exportingManual} className="qb-file-export" title={t('btn.exportManual')}><BookOpen aria-hidden="true" /><strong>{t('chrome.manual')}</strong><small>{t('chrome.manualHint')}</small></button>
        </div>
        <button onClick={() => void api.shareCurrent()} className="qb-file-row"><Link aria-hidden="true" /><span>{t('btn.share')}</span></button>
      </section>
      {batch && <BatchImport onClose={() => setBatch(false)} />}
      {legacy && <Modal onClose={() => setLegacy(null)} label={t('saves.legacyBackup')}>
        <p className="text-sm mb-3">{t('saves.legacyBackupHint')}</p>
        <button className={btn} onClick={() => storage.exportFile(legacy, 'quadro-old-device-backup.json')}>{t('saves.legacyBackupAll')}</button>
        {!legacyModels.length && <p className="text-sm mt-3">{t('saves.empty')}</p>}
        <div className="flex flex-col gap-2 mt-3 max-h-[50vh] overflow-auto">
          {legacyModels.map((row, index) => <button key={index} className={btn} onClick={() => {
            const name = String(row.name || t('tab.untitled')).replace(/[\\/:*?"<>|]/g, '_')
            storage.exportFile(row.data, `${name}.json`)
          }}>{t('saves.legacyDownload', { name: row.name || t('tab.untitled') })}</button>)}
        </div>
      </Modal>}

      <details className="qb-file-room">
        <summary><span>{t('section.room')}</span><ChevronDown size={16} aria-hidden="true" /></summary>
        <label className="qb-file-check">
          <input type="checkbox" checked={api.room.visible} onChange={e => api.setRoom({ visible: e.target.checked })} className="accent-sky-500" />
          {t('room.show')}
        </label>
        <label className="qb-file-check">
          <input type="checkbox" checked={api.room.showExtents} onChange={e => api.setRoom({ showExtents: e.target.checked })} className="accent-sky-500" />
          {t('room.extents')}
        </label>
        <div className="qb-file-dimensions">
          <CmField label={t('room.w')} value={api.room.w} onCommit={n => api.setRoom({ w: n })} />
          <CmField label={t('room.d')} value={api.room.d} onCommit={n => api.setRoom({ d: n })} />
          <CmField label={t('room.h')} value={api.room.h} onCommit={n => api.setRoom({ h: n })} />
        </div>
      </details>

      <button onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))} className="qb-file-row"><Sparkles aria-hidden="true" /><span>{t('onboard.replay')}</span></button>
      <section className="qb-file-separated" aria-labelledby="qb-file-language">
        <h2 id="qb-file-language" className="qb-file-section">{t('chrome.language')}</h2>
        <div className="qb-file-languages">
          {LANGS.map(item => (
            <button key={item.id} onClick={() => setLang(item.id)}
              aria-pressed={lang === item.id} className={lang === item.id ? 'qb-file-primary' : ''}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function CmField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-gray-500">{label}</span>
      <input
        type="number"
        min={40}
        max={2000}
        value={txt}
        onChange={e => setTxt(e.target.value)}
        onBlur={() => onCommit(Number(txt))}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-1 py-2 text-sm tabular-nums outline-none focus:border-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </label>
  )
}
