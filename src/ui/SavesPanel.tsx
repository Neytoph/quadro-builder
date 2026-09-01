import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { useDock } from './dock'

export default function SavesPanel() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const [docs, setDocs] = useState<Array<{ id: string; name: string; updatedAt: number }>>([])

  useEffect(() => {
    void api.listDocs().then(setDocs)
  }, [api])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
      {!docs.length && <div className="text-xs text-gray-500 px-2 py-6 text-center">{t('saves.empty')}</div>}
      {docs.map(d => (
        <div key={d.id} className="flex flex-col gap-1.5 rounded-xl border border-gray-800 px-3 py-2 mb-2">
          <div className="min-w-0">
            <div className="text-sm text-gray-100 truncate">{d.name}</div>
            <div className="text-[10px] text-gray-500">{new Date(d.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : lang)}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { void api.openDoc(d.id); setPane('bom') }} className="text-xs text-teal-300 hover:text-teal-100 cursor-pointer">{t('saves.open')}</button>
            <button onClick={() => {
              const name = window.prompt(t('saves.namePrompt'), d.name)
              if (name) void api.renameDoc(d.id, name).then(() => api.listDocs().then(setDocs))
            }} className="text-xs text-gray-400 hover:text-white cursor-pointer">{t('saves.rename')}</button>
            <button onClick={() => {
              if (window.confirm(t('confirm.delete'))) void api.removeDoc(d.id).then(() => api.listDocs().then(setDocs))
            }} className="text-xs text-red-400 hover:text-red-200 cursor-pointer">{t('saves.delete')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
