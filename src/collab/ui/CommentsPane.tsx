import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { mediaUrl, type Post, type Thread } from '../api'
import { isDesigner, useCollab } from '../CollabContext'
import { day, Face, when } from './bits'
import { Compose, RefCard } from './Compose'

type Filter = 'open' | 'done' | 'all'

/**
 * 评论和留言（右侧抽屉）：两栏「位置评论」「留言」，各带未读数。位置评论按图钉号排，
 * 默认只看没解决的；点一条镜头飞过去、在图钉旁边打开讨论。留言区第一条是需求单，
 * 上次看到的地方一条红线。打开时记下「读到哪儿」，这一次的红点留到关上抽屉。
 */
export default function CommentsPane() {
  const collab = useCollab()
  const { t } = useI18n()
  const [tab, setTab] = useState<'pins' | 'chat'>(collab.unread.chat && !collab.unread.pins ? 'chat' : 'pins')
  const [filter, setFilter] = useState<Filter>('open')
  const seen = useRef<(p: Post) => boolean>(collab.isUnread)

  useEffect(() => {
    collab.refreshThreads().catch(collab.report)
    collab.markRead().catch(collab.report)
    // 只在打开时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allPins = collab.threads.filter(th => th.kind === 'pin').sort((a, b) => collab.pinNumber(a) - collab.pinNumber(b))
  const open = allPins.filter(th => !th.resolved)
  const done = allPins.filter(th => th.resolved)
  const chat = collab.threads.find(th => th.kind === 'chat') || null
  const unreadIn = (th: Thread) => th.posts.filter(p => seen.current(p)).length
  const pinUnread = allPins.reduce((s, th) => s + unreadIn(th), 0)
  const chatUnread = chat ? unreadIn(chat) : 0

  return (
    <div className="cb-pane" data-ui="comments-pane">
      <div className="cb-tabs">
        <button type="button" className={tab === 'pins' ? 'on' : ''} onClick={() => setTab('pins')} data-ui="comments-tab-pins">
          {t('collab.tab.pins')}{pinUnread > 0 && <b className="cb-n">{pinUnread}</b>}
        </button>
        <button type="button" className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')} data-ui="comments-tab-chat">
          {t('collab.tab.chat')}{chatUnread > 0 && <b className="cb-n">{chatUnread}</b>}
        </button>
      </div>

      {tab === 'pins' && (
        <>
          <div className="cb-filter">
            <button type="button" className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>{t('collab.filter.open', { n: open.length })}</button>
            <button type="button" className={filter === 'done' ? 'on' : ''} onClick={() => setFilter('done')}>{t('collab.filter.done', { n: done.length })}</button>
            <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('collab.filter.all', { n: allPins.length })}</button>
          </div>
          <div className="cb-list">
            {filter !== 'done' && open.map(th => <PinItem key={th.id} th={th} unread={unreadIn(th)} />)}
            {filter === 'all' && done.length > 0 && <div className="cb-sechead">{t('collab.pin.resolved')}</div>}
            {filter !== 'open' && done.map(th => <PinItem key={th.id} th={th} unread={unreadIn(th)} />)}
            {!allPins.length && <div className="cb-empty">{t(collab.role === 'guest' ? 'collab.pin.emptyGuest' : 'collab.pin.empty')}</div>}
            {allPins.length > 0 && filter === 'open' && !open.length && <div className="cb-empty">{t('collab.pin.allDone')}</div>}
          </div>
        </>
      )}

      {tab === 'chat' && <Chat chat={chat} seen={seen.current} />}
    </div>
  )
}

function PinItem({ th, unread }: { th: Thread; unread: number }) {
  const collab = useCollab()
  const { t, lang } = useI18n()
  const first = th.posts[0]
  const gone = collab.partGone(th)
  const replies = th.posts.length - 1
  const meta = [
    first?.name, first ? day(first.createdAt, lang) : '',
    replies > 0 ? t('collab.pin.replies', { n: replies }) : !th.anchor?.partId ? t('collab.pin.space') : '',
    unread > 0 ? t('collab.pin.newN', { n: unread }) : '',
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" data-ui="pin-thread" data-thread={th.id}
      className={`cb-item ${th.resolved ? 'done' : ''} ${gone ? 'gone' : ''} ${unread ? 'unread' : ''} ${collab.activeThread === th.id ? 'on' : ''}`}
      onClick={() => collab.focusThread(th)}>
      <span className="pn"><b>{collab.pinNumber(th)}</b></span>
      <div>
        <p>{first?.body || t('collab.pin.photoOnly')}</p>
        <div className="mt">
          {gone && <span className="gtag">{t('collab.pin.partGone')}</span>}
          {th.resolved && <span className="dtag">{t('collab.pin.resolved')}</span>}
          {meta}
        </div>
      </div>
    </button>
  )
}

function Chat({ chat, seen }: { chat: Thread | null; seen: (p: Post) => boolean }) {
  const collab = useCollab()
  const { t, lang } = useI18n()
  const me = collab.plan?.me
  const posts = chat?.posts || []
  const firstNew = posts.findIndex(seen)
  const newCount = posts.filter(seen).length
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [posts.length])

  return (
    <>
      <div className="cb-chat" data-ui="chat">
        {!posts.length && <div className="cb-empty">{t('collab.chat.empty')}</div>}
        {posts.map((p, i) => {
          const mine = !!me && p.userId === me.userId
          // 需求单建的方案：第一条是后端按需求单排好的文字
          const brief = i === 0 && collab.plan?.briefId != null
          return (
            <div key={p.id} style={{ display: 'contents' }}>
              {i === firstNew && <div className="cb-unread-line">{t('collab.chat.newLine', { n: newCount })}</div>}
              <div className={`cb-msg ${mine ? 'me' : ''}`} data-ui="post">
                <Face name={p.name} avatar={p.avatar} color={collab.colorOf(p.userId)} />
                <div>
                  <div className="who">
                    {mine ? <><small>{when(p.createdAt, lang)}</small> {p.name}</> : <>{p.name}
                      {isDesigner(collab.plan, p.userId) && <span className="role">{t('collab.designer')}</span>}
                      <small>{when(p.createdAt, lang)}{brief ? ` · ${t('collab.chat.brief')}` : ''}</small></>}
                  </div>
                  {brief ? <div className="cb-briefmsg">{p.body}</div> : (
                    <div className="txt">
                      {p.body}
                      {p.photos.length > 0 && <div className="pics">{p.photos.map(src => <a key={src} href={mediaUrl(src)} target="_blank" rel="noreferrer"><img src={mediaUrl(src)} alt="" /></a>)}</div>}
                      {p.refs.map((r, j) => <RefCard key={j} r={r} />)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {chat && collab.role !== 'guest' && (
        <Compose placeholder={t('collab.chat.placeholder')} sendLabel={t('collab.send')} withRefs
          send={(body, files, refs) => collab.reply(chat.id, body, files, refs)} />
      )}
      {collab.role === 'guest' && !collab.plan?.me && (
        <div className="cb-login-reply"><a className="qb-btn qb-btn-sm no-underline" href={collab.loginUrl()}>{t('collab.readOnly.login')}</a></div>
      )}
    </>
  )
}
