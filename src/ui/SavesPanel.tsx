import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n, type Lang } from '../i18n'
import { useDock } from './dock'
import { onSyncStart, syncConfigured, syncStarted } from '../sync/bootstrap'
import { useCollab } from '../collab/CollabContext'
import { docs } from '../engine-api'
import { track } from '../analytics/track'
import { publishEnabled, publishPage, publishStates, withdrawDoc, type PublishState } from '../publish'

// 构建时写进来的各语言发帖页地址（见 vite-env.d.ts）。没设就是空表。
const WRITE_PAGES: Partial<Record<Lang, string>> = JSON.parse(import.meta.env.VITE_COMMUNITY_WRITE || '{}')

/** 同步跑起来了没有（后端认得出这个人）。发到社区、发布到广场都要它。 */
function useSyncOn(): boolean {
  const [on, setOn] = useState(syncStarted)
  useEffect(() => (on ? undefined : onSyncStart(() => setOn(true))), [on])
  return on
}

/**
 * 「发到社区」摆不摆得出来，要两个都成立：
 *  1. 构建时设了 VITE_COMMUNITY_WRITE——开源本地版没有社区可发；
 *  2. 同步跑起来了，也就是后端认得出这个人。发帖页只认服务器上那张列表，
 *     没登录的时候这一座送不上去。
 * 去的是当前界面语言的那一页，托管版的站点每种语言一套网址。
 */
function communityWrite(lang: Lang, on: boolean): string {
  if (!Object.keys(WRITE_PAGES).length) return ''
  const write = WRITE_PAGES[lang]
  if (!write) throw new Error(`VITE_COMMUNITY_WRITE 里没有 ${lang} 的发帖页地址`)
  return on ? write : ''
}

export default function SavesPanel() {
  const api = useEngine()
  const collab = useCollab()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const [docList, setDocs] = useState<Array<{ id: string; name: string; updatedAt: number; local: boolean }>>([])
  // 没接同步的部署没有云端，每一座都在本机，标出来没有意义
  const cloud = syncConfigured()
  const syncOn = useSyncOn()
  const write = communityWrite(lang, syncOn)
  // 「发布到广场」的显示条件和「发到社区」一样：托管版、同步跑起来了
  const plaza = publishEnabled() && syncOn
  const [states, setStates] = useState<Map<string, PublishState>>(new Map())
  const [sending, setSending] = useState('')

  const refresh = useCallback(() => {
    void api.listDocs().then(setDocs)
    if (plaza) void publishStates().then(setStates)
  }, [api, plaza])
  useEffect(refresh, [refresh])

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

  /**
   * 发布（或者更新）到广场：先给这一座截一张画面当封面，连同最新的版本和量一起送上去，
   * 发布页从服务器取这一份。点下去这一刻的版本就是发出去的版本。
   */
  const publish = async (docId: string, update: boolean) => {
    setSending(docId)
    try {
      const doc = await docs.getDoc(docId) as { data: unknown } | null
      if (!doc) return
      const thumb = await api.captureThumb({ kind: 'model', data: doc.data })
      if (thumb) await docs.setDocCover(docId, thumb)
      if (!await api.pushDoc(docId)) {
        api.notify(t('saves.shareNotYet'), 'warn')
        return
      }
      track('builder.design.publish', { update })
      location.href = publishPage(lang, docId)
    } finally {
      setSending('')
    }
  }

  const withdraw = async (docId: string) => {
    if (!window.confirm(t('saves.withdrawConfirm'))) return
    setSending(docId)
    try {
      await withdrawDoc(docId)
      track('builder.design.withdraw')
      api.notify(t('saves.withdrawn'))
      refresh()
    } finally {
      setSending('')
    }
  }

  return (
    <div className="p-3">
      {!docList.length && <div className="text-xs text-gray-500 px-2 py-6 text-center">{t('saves.empty')}</div>}
      {docList.map(d => {
        const pub = states.get(d.id)
        return (
          <div key={d.id} className="flex flex-col gap-1.5 rounded-xl border border-gray-800 px-3 py-2 mb-2" data-ui="saved-doc">
            <div className="min-w-0">
              <div className="text-sm text-gray-100 truncate">{d.name}</div>
              <div className="text-[10px] text-gray-500">
                {new Date(d.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : lang)}
                {cloud && d.local && <span className="ml-1.5 text-amber-700">· {t('saves.localOnly')}</span>}
                {pub && (
                  <a href={pub.url} className="ml-1.5 text-teal-700 hover:underline" data-ui="saved-published">
                    · {t(pub.hidden ? 'saves.hidden' : 'saves.published')}
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <button onClick={() => {
                // 开启过共享的这一座改走共享方案：打开方案的标签页
                if (collab.planOfDoc(d.id)) collab.openPlan(d.id).catch(collab.report)
                else void api.openDoc(d.id)
                setPane('bom')
              }} className="text-xs text-teal-300 hover:text-teal-100 cursor-pointer">{t('saves.open')}</button>
              {collab.planOfDoc(d.id) && <span className="text-[11px] text-orange-600">{t('collab.sharedTag')}</span>}
              <button onClick={() => {
                void api.askName(t('saves.rename'), t('saves.rename'), d.name).then(name => {
                  if (name) void api.renameDoc(d.id, name).then(refresh)
                })
              }} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('saves.rename')}</button>
              <button onClick={() => { void api.duplicateDoc(d.id).then(refresh) }}
                className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('saves.duplicate')}</button>
              {/* 刚搭完是最想说两句的时候。从这儿走，那座会跟着进正文，不用再挑一遍。 */}
              {write && (
                <button onClick={() => { void share(d.id) }} disabled={!!sending}
                  className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer disabled:cursor-wait">
                  {sending === d.id ? t('saves.sharing') : t('saves.share')}
                </button>
              )}
              {/* 已经在广场上的：没改过就不摆发布按钮（再发一次也是去更新那一张），改过了换成「更新」 */}
              {plaza && (!pub || pub.stale) && (
                <button onClick={() => { void publish(d.id, !!pub) }} disabled={!!sending} data-ui={pub ? 'saved-update' : 'saved-publish'}
                  className="text-xs text-teal-600 hover:text-teal-800 font-medium cursor-pointer disabled:cursor-wait">
                  {sending === d.id ? t('saves.sharing') : t(pub ? 'saves.update' : 'saves.publish')}
                </button>
              )}
              {plaza && pub && (
                <button onClick={() => { void withdraw(d.id) }} disabled={!!sending} data-ui="saved-withdraw"
                  className="text-xs text-gray-400 hover:text-red-400 cursor-pointer disabled:cursor-wait">{t('saves.withdraw')}</button>
              )}
              <button onClick={() => {
                if (window.confirm(t('confirm.delete'))) void api.removeDoc(d.id).then(refresh)
              }} className="text-xs text-red-400 hover:text-red-200 cursor-pointer">{t('saves.delete')}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
