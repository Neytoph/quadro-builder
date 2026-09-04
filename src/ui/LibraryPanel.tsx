import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { storage, designEntry, checkAgainstInventory, missingCount } from '../engine-api'
import { OFFICIAL_MODELS, officialThumbPath } from '../data/official'
import { MODULES, PRESETS, presetThumbPath, type PresetDef } from '../data/presets'

export const LIBRARY_OPEN_EVENT = 'quadro:library-open'

type LibMeta = {
  connectors?: number
  tubes?: number
  panels?: number
  slides?: number
  price?: number
  size?: number[]
  parts?: Record<string, Record<string, number>>
}

type LibEntry = {
  id: string
  name: string
  file: string
  qdf?: string | null
  meta?: LibMeta
}

type Tab = 'official' | 'start' | 'mine'

function isQdf(file: File) {
  return file.name.toLowerCase().endsWith('.qdf')
}

function yieldUi() {
  return new Promise<void>(resolve => { requestAnimationFrame(() => resolve()) })
}

function hideBrokenImg(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none'
}

function StartCard({ p, label, onClick }: { p: PresetDef; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} · ${p.hint}`}
      className="text-left rounded-xl border border-gray-800 bg-gray-900/80 hover:border-teal-400 cursor-pointer overflow-hidden"
    >
      <div className="aspect-[4/3] bg-[#edd8c4] overflow-hidden">
        <img src={presetThumbPath(p.key)} alt="" loading="lazy" draggable={false}
          className="w-full h-full object-contain"
          onError={hideBrokenImg} />
      </div>
      <div className="px-1.5 py-1.5">
        <div className="text-[11px] text-gray-100 leading-snug">{label}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{p.hint}</div>
      </div>
    </button>
  )
}

export default function LibraryPanel() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('official')
  const [rows, setRows] = useState<LibEntry[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const hasStock = useMemo(() => (
    Object.values(api.inventory).some(group => Object.values(group).some(n => Number(n) > 0))
  ), [api.inventory])

  const reload = useCallback(async () => {
    const list = (await storage.libAll()) as LibEntry[]
    setRows(list.filter(r => !String(r.id).startsWith('official:')))
  }, [])

  useEffect(() => { void reload() }, [reload])

  const ingest = async (fileList: FileList | File[]) => {
    const list = [...fileList].filter(isQdf)
    if (!list.length) {
      api.notify(t('lib.noneQdf'), 'warn')
      return
    }
    setBusy({ done: 0, total: list.length })
    let added = 0
    let skipped = 0
    const pending: unknown[] = []
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const text = await file.text()
        const rel = 'webkitRelativePath' in file ? String((file as File & { webkitRelativePath: string }).webkitRelativePath || '') : ''
        const entry = designEntry(`lib:${rel || file.name}`, file.name, text)
        if (entry) {
          pending.push(entry)
          added++
        } else {
          skipped++
        }
        if (pending.length >= 10) {
          await storage.libPut(pending)
          pending.length = 0
        }
        setBusy({ done: i + 1, total: list.length })
        if (i % 3 === 2) await yieldUi()
      }
      if (pending.length) await storage.libPut(pending)
      await reload()
      setTab('mine')
      api.notify(skipped ? t('lib.addedSkip', { n: added, skipped }) : t('lib.added', { n: added }))
    } catch (err) {
      api.notify(t('toast.importFailed', { err: err instanceof Error ? err.message : String(err) }), 'err')
    } finally {
      setBusy(null)
    }
  }

  const officialVisible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return OFFICIAL_MODELS.filter(m => !q || `${m.id} ${m.name}`.toLowerCase().includes(q))
  }, [query])

  const mineVisible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const locale = lang === 'zh' ? 'zh' : lang === 'de' ? 'de' : 'en'
    return rows
      .filter(row => !q || `${row.name} ${row.file}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [rows, query, lang])

  const openId = async (id: string) => {
    setOpening(id)
    try {
      await api.openLibraryId(id)
    } finally {
      setOpening(null)
    }
  }

  const startDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-2 sticky top-0 z-10 bg-gray-950/92 backdrop-blur">
        <div className="flex bg-gray-800/80 rounded-lg p-0.5">
          <button onClick={() => setTab('official')}
            className={`flex-1 px-2 py-1.5 md:py-1 rounded-md text-xs md:text-[11px] cursor-pointer ${tab === 'official' ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>
            {t('lib.official')} · {OFFICIAL_MODELS.length}
          </button>
          <button onClick={() => setTab('start')}
            className={`flex-1 px-2 py-1.5 md:py-1 rounded-md text-xs md:text-[11px] cursor-pointer ${tab === 'start' ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>
            {t('section.presets')}
          </button>
          <button onClick={() => setTab('mine')}
            className={`flex-1 px-2 py-1.5 md:py-1 rounded-md text-xs md:text-[11px] cursor-pointer ${tab === 'mine' ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>
            {t('lib.mine')} · {rows.length}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 leading-snug">{t('lib.hint')} {t('lib.drag')}</p>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('lib.search')}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-teal-500" />
        {tab === 'mine' && (
          <div className="flex flex-wrap gap-1.5">
            <button disabled={!!busy} onClick={() => folderRef.current?.click()}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer disabled:opacity-40">{t('lib.folder')}</button>
            <button disabled={!!busy} onClick={() => filesRef.current?.click()}
              className="text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer disabled:opacity-40">{t('lib.files')}</button>
            <button disabled={!!busy || !rows.length} onClick={() => {
              if (!window.confirm(t('lib.confirmClear'))) return
              void Promise.all(rows.map(r => storage.libRemove(r.id))).then(() => reload()).then(() => api.notify(t('lib.cleared')))
            }} className="text-xs rounded-lg border border-red-900 bg-red-950/40 hover:border-red-400 px-2 py-1.5 cursor-pointer disabled:opacity-40">{t('lib.clear')}</button>
            <input
              ref={el => {
                folderRef.current = el
                if (!el) return
                el.setAttribute('webkitdirectory', '')
                el.setAttribute('directory', '')
                el.multiple = true
              }}
              type="file"
              multiple
              hidden
              onChange={e => { const f = e.target.files; e.target.value = ''; if (f?.length) void ingest(f) }}
            />
            <input ref={filesRef} type="file" accept=".qdf,application/octet-stream" multiple hidden
              onChange={e => { const f = e.target.files; e.target.value = ''; if (f?.length) void ingest(f) }} />
          </div>
        )}
      </div>

      <div className="p-2">
        {tab === 'start' && (
          <div className="space-y-3 px-0.5 pb-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{t('section.modules')}</div>
              <p className="text-[11px] text-gray-500 mb-2 leading-snug">{t('hint.modules')}</p>
              <div className="grid grid-cols-2 gap-2">
                {MODULES.map(p => (
                  <StartCard key={p.key} p={p} label={t(p.labelKey)} onClick={() => api.placeModule(p.key)} />
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">{t('section.presets')}</div>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(p => (
                  <StartCard
                    key={p.key}
                    p={p}
                    label={t(p.labelKey)}
                    onClick={() => p.mode === 'replace' ? api.loadPreset(p.key) : api.placeModule(p.key)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'official' && (
          officialVisible.length === 0
            ? <div className="text-xs text-gray-500 px-2 py-6 text-center">{t('lib.noMatch')}</div>
            : (
              <div className="grid grid-cols-2 gap-2">
                {officialVisible.map(m => {
                  const busyCard = opening === m.id
                  return (
                    <button
                      key={m.id}
                      draggable
                      onDragStart={e => startDrag(e, m.id)}
                      onClick={() => void openId(m.id)}
                      title={`${m.id} · ${m.name}\n${t('lib.drag')}`}
                      className={`text-left rounded-xl border border-gray-800 bg-gray-900/80 hover:border-teal-400 cursor-grab active:cursor-grabbing overflow-hidden ${busyCard ? 'opacity-60' : ''}`}
                    >
                      <div className="aspect-[4/3] bg-[#edd8c4] overflow-hidden">
                        <img src={officialThumbPath(m.id)} alt="" loading="lazy" draggable={false}
                          className="w-full h-full object-contain"
                          onError={hideBrokenImg} />
                      </div>
                      <div className="px-1.5 py-1.5">
                        <div className="text-[10px] text-teal-300 font-mono">{m.id}</div>
                        <div className="text-[11px] text-gray-100 leading-snug line-clamp-2">{m.name}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
        )}

        {tab === 'mine' && (
          <>
            {busy && <div className="text-[11px] text-teal-300 tabular-nums mb-2">{t('lib.reading', { done: busy.done, total: busy.total })}</div>}
            {!rows.length && !busy && (
              <div className="text-xs text-gray-500 px-2 py-8 text-center leading-relaxed">{t('lib.emptyMine')}</div>
            )}
            {!!rows.length && !mineVisible.length && (
              <div className="text-xs text-gray-500 px-2 py-8 text-center">{t('lib.noMatch')}</div>
            )}
            {mineVisible.map(row => {
              const size = row.meta?.size || [0, 0, 0]
              const check = hasStock ? checkAgainstInventory(row.meta || {}, api.inventory) : null
              const miss = check ? missingCount(check) : 0
              return (
                <div key={row.id}
                  draggable
                  onDragStart={e => startDrag(e, row.id)}
                  className="flex items-start gap-2 rounded-xl border border-gray-800 px-2.5 py-2 mb-2 cursor-grab active:cursor-grabbing">
                  <button onClick={() => void openId(row.id)} className="flex-1 min-w-0 text-left cursor-pointer">
                    <div className="text-sm text-gray-100 truncate">{row.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {t('lib.size', { w: size[0] || 0, h: size[1] || 0, d: size[2] || 0 })}
                      {' · '}
                      {t('lib.parts', { conn: row.meta?.connectors || 0, tubes: row.meta?.tubes || 0, panels: row.meta?.panels || 0 })}
                    </div>
                    {check && (
                      <div className={`text-[10px] mt-0.5 ${check.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {check.ok ? t('lib.feasible') : t('lib.missing', { n: miss })}
                      </div>
                    )}
                  </button>
                  <button onClick={() => {
                    if (!window.confirm(t('lib.confirmDelete', { name: row.name }))) return
                    void storage.libRemove(row.id).then(() => reload())
                  }} className="text-xs text-red-400 hover:text-red-200 cursor-pointer shrink-0 mt-0.5">{t('lib.delete')}</button>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
