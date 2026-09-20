import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { useDock } from './dock'

/**
 * 「发到社区」摆不摆得出来，要两个都成立：
 *  1. 构建时设了 VITE_COMMUNITY_WRITE——开源本地版没有社区可发；
 *  2. 后端说这个人看得见社区（没开放的时候只有审核员看得见）。
 * 问不出来就当没有。这条入口缺了只是少一条路，摆错了是把人送去一扇打不开的门。
 */
function useCommunityWrite(): string {
  const [href, setHref] = useState('')
  useEffect(() => {
    const write = import.meta.env.VITE_COMMUNITY_WRITE
    const base = import.meta.env.VITE_SYNC_BASE
    if (!write || !base) return
    let alive = true
    void fetch(`${base}/cmty/gate`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => { if (alive && g && g.mine) setHref(write) })
      .catch(() => { /* 问不出来就不摆 */ })
    return () => { alive = false }
  }, [])
  return href
}

export default function SavesPanel() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const [docs, setDocs] = useState<Array<{ id: string; name: string; updatedAt: number }>>([])
  const write = useCommunityWrite()

  useEffect(() => {
    void api.listDocs().then(setDocs)
  }, [api])

  return (
    <div className="p-3">
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
            }} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('saves.rename')}</button>
            {/* 刚搭完是最想说两句的时候。从这儿走，那座会跟着进正文，不用再挑一遍。 */}
            {write && (
              <a href={`${write}?board=show&model=${encodeURIComponent(d.id)}`}
                className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('saves.share')}</a>
            )}
            <button onClick={() => {
              if (window.confirm(t('confirm.delete'))) void api.removeDoc(d.id).then(() => api.listDocs().then(setDocs))
            }} className="text-xs text-red-400 hover:text-red-200 cursor-pointer">{t('saves.delete')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
