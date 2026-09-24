import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import type { Post, Thread } from '../api'
import { Composer, PostView } from './Posts'

/**
 * 评论侧栏：位置评论和留言区两栏。打开时记下「上次读到哪儿」，这一次看到的红点
 * 一直留到关上侧栏，同时告诉服务端已读，顶栏的数字随即消失。
 */
export default function CommentsPane() {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const [tab, setTab] = useState<'pins' | 'chat'>(collab.unread.chat && !collab.unread.pins ? 'chat' : 'pins')
  const [showResolved, setShowResolved] = useState(false)
  const seen = useRef<(p: Post) => boolean>(collab.isUnread)
  const isMember = collab.role !== 'guest'

  useEffect(() => {
    collab.refreshThreads().catch(collab.report)
    collab.markRead().catch(collab.report)
    // 只在打开时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pins = collab.threads.filter(th => th.kind === 'pin' && (showResolved || !th.resolved))
  const resolvedCount = collab.threads.filter(th => th.kind === 'pin' && th.resolved).length
  const chat = collab.threads.find(th => th.kind === 'chat') || null
  const unreadIn = (th: Thread) => th.posts.filter(p => seen.current(p)).length

  return (
    <div className="flex flex-col" data-ui="comments-pane">
      <div className="flex gap-1 p-2 border-b border-gray-800 sticky top-[49px] z-10 bg-teal-50">
        {(['pins', 'chat'] as const).map(k => {
          const n = k === 'pins'
            ? collab.threads.filter(th => th.kind === 'pin').reduce((s, th) => s + unreadIn(th), 0)
            : (chat ? unreadIn(chat) : 0)
          return (
            <button key={k} onClick={() => setTab(k)} data-ui={`comments-tab-${k}`}
              className={`relative flex-1 text-sm rounded-lg py-2 cursor-pointer ${tab === k ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300 hover:bg-gray-800'}`}>
              {t(k === 'pins' ? 'collab.tab.pins' : 'collab.tab.chat')}
              {n > 0 && <span className="absolute top-1.5 right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4">{n}</span>}
            </button>
          )
        })}
      </div>

      {tab === 'pins' && (
        <div className="p-3 flex flex-col gap-2">
          {isMember && (
            <button onClick={() => { collab.setPlacingPin(true); api.notify(t('collab.pin.placeHint')) }}
              className="qb-btn qb-btn-sm self-start" data-ui="pin-start">{t('collab.pin.add')}</button>
          )}
          {!pins.length && <div className="text-xs text-gray-500 py-4 text-center">{t('collab.pin.empty')}</div>}
          {pins.map(th => <PinThread key={th.id} th={th} unread={p => seen.current(p)} />)}
          {resolvedCount > 0 && (
            <button onClick={() => setShowResolved(v => !v)} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer self-start">
              {t(showResolved ? 'collab.pin.hideResolved' : 'collab.pin.showResolved', { n: resolvedCount })}
            </button>
          )}
        </div>
      )}

      {tab === 'chat' && (
        <div className="p-3 flex flex-col gap-2" data-ui="chat">
          <div className="text-[11px] text-gray-400">{t('collab.chat.hint')}</div>
          <div className="flex flex-col divide-y divide-gray-800">
            {(chat?.posts || []).map(p => <PostView key={p.id} p={p} unread={seen.current(p)} />)}
          </div>
          {!chat?.posts.length && <div className="text-xs text-gray-500 py-4 text-center">{t('collab.chat.empty')}</div>}
          {isMember && chat && (
            <Composer placeholder={t('collab.chat.placeholder')} withRefs
              onSend={(body, files, refs) => collab.reply(chat.id, body, files, refs)} />
          )}
        </div>
      )}
    </div>
  )
}

function PinThread({ th, unread }: { th: Thread; unread: (p: Post) => boolean }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const open = collab.activeThread === th.id
  const first = th.posts[0]
  const gone = collab.partGone(th)
  const n = th.posts.filter(unread).length
  const isMember = collab.role !== 'guest'

  return (
    <div data-ui="pin-thread" data-thread={th.id}
      className={`rounded-xl border px-3 py-2 ${open ? 'border-teal-500 bg-gray-900' : 'border-gray-800'} ${th.resolved ? 'opacity-70' : ''}`}>
      <button className="w-full text-left cursor-pointer" onClick={() => (open ? collab.setActiveThread(null) : collab.focusThread(th))}>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold inline-flex items-center justify-center">{collab.pinNumber(th)}</span>
          <span className="text-gray-200 font-medium truncate">{first?.name}</span>
          {th.resolved && <span className="rounded bg-gray-800 px-1">{t('collab.pin.resolved')}</span>}
          {gone && <span className="rounded bg-amber-100 text-amber-800 px-1" data-ui="pin-gone">{t('collab.pin.partGone')}</span>}
          {n > 0 && <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">{n}</span>}
        </div>
        {!open && <div className="text-sm text-gray-100 line-clamp-2 mt-0.5">{first?.body}</div>}
        {!open && th.posts.length > 1 && <div className="text-[11px] text-gray-400 mt-0.5">{t('collab.pin.replies', { n: th.posts.length - 1 })}</div>}
      </button>
      {open && (
        <div className="mt-1">
          <div className="flex flex-col divide-y divide-gray-800">
            {th.posts.map(p => <PostView key={p.id} p={p} unread={unread(p)} />)}
          </div>
          {isMember && (
            <div className="mt-2 flex flex-col gap-2">
              <Composer placeholder={t('collab.pin.reply')} onSend={(body, files) => collab.reply(th.id, body, files, [])} />
              <button onClick={() => { void collab.resolve(th.id, !th.resolved).catch(err => api.notify(String(err instanceof Error ? err.message : err), 'err')) }}
                className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer self-start" data-ui="pin-resolve">
                {t(th.resolved ? 'collab.pin.reopen' : 'collab.pin.resolve')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
