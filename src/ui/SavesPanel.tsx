import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { useDock } from './dock'
import { onSyncStart, syncStarted } from '../sync/bootstrap'

/**
 * 「发到社区」摆不摆得出来，要两个都成立：
 *  1. 构建时设了 VITE_COMMUNITY_WRITE——开源本地版没有社区可发；
 *  2. 同步跑起来了，也就是后端认得出这个人。发帖页只认服务器上那张列表，
 *     没登录的时候这一座送不上去。
 */
function useCommunityWrite(): string {
  const write = import.meta.env.VITE_COMMUNITY_WRITE || ''
  const [on, setOn] = useState(syncStarted)
  useEffect(() => (on ? undefined : onSyncStart(() => setOn(true))), [on])
  return on ? write : ''
}

export default function SavesPanel() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const [docs, setDocs] = useState<Array<{ id: string; name: string; updatedAt: number }>>([])
  const write = useCommunityWrite()
  const [sending, setSending] = useState('')

  useEffect(() => {
    void api.listDocs().then(setDocs)
  }, [api])

  /**
   * 发帖页只认服务器上那张列表，所以先把这一座送上去，送到了再走。
   * 送不上去就留在原地说一声——跳过去只会让人对着一句"你还没存过造型"发愣。
   */
  const share = async (docId: string) => {
    setSending(docId)
    try {
      if (!await api.pushDoc(docId)) {
        api.notify(t('saves.shareNotYet'), 'warn')
        return
      }
      location.href = `${write}?board=show&model=${encodeURIComponent(docId)}`
    } finally {
      setSending('')
    }
  }

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
              <button onClick={() => { void share(d.id) }} disabled={!!sending}
                className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer disabled:cursor-wait">
                {sending === d.id ? t('saves.sharing') : t('saves.share')}
              </button>
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
