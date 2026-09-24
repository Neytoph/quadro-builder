import { useRef, useState } from 'react'
import { useI18n, type Lang } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { mediaUrl, type Post, type Ref } from '../api'
import { useCollab } from '../CollabContext'
import { peerColor } from '../planSession'
import { Avatar } from './PlanBar'

export function when(ms: number, lang: Lang) {
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'de' ? 'de-DE' : 'en-US'
  return new Date(ms).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 引用的东西：一条评论、一个版本、一份复制件，点开跳过去。 */
export function RefChip({ r, onRemove }: { r: Ref; onRemove?: () => void }) {
  const collab = useCollab()
  const { t } = useI18n()
  let label = ''
  let go: (() => void) | null = null
  if (r.kind === 'thread') {
    const th = collab.threads.find(x => x.id === Number(r.id))
    label = t('collab.ref.thread', { text: (th?.posts[0]?.body || '').slice(0, 16) })
    if (th) go = () => collab.focusThread(th)
  } else if (r.kind === 'version') {
    const v = collab.versions.find(x => x.id === Number(r.id))
    label = t('collab.ref.version', { name: v?.name || String(r.id) })
    go = () => collab.openCompare(String(r.id), 'current')
  } else {
    label = t('collab.ref.fork')
    go = () => collab.openCompare('current', `fork:${r.id}`)
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5 text-[11px] text-gray-200 max-w-full">
      <button type="button" onClick={go || undefined} disabled={!go} className="truncate cursor-pointer disabled:cursor-default hover:text-teal-600">{label}</button>
      {onRemove && <button type="button" onClick={onRemove} className="text-gray-500 hover:text-red-400 cursor-pointer" aria-label="×">×</button>}
    </span>
  )
}

export function PostView({ p, unread }: { p: Post; unread: boolean }) {
  const { lang } = useI18n()
  return (
    <div className="flex gap-2 py-2" data-ui="post">
      <Avatar name={p.name} avatar={p.avatar} color={peerColor(p.userId)} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="text-gray-200 font-medium truncate">{p.name}</span>
          <span>{when(p.createdAt, lang)}</span>
          {unread && <span className="w-1.5 h-1.5 rounded-full bg-red-500" data-ui="post-unread" />}
        </div>
        {p.body && <div className="text-sm text-gray-100 whitespace-pre-wrap break-words mt-0.5">{p.body}</div>}
        {p.photos.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {p.photos.map(src => (
              <a key={src} href={mediaUrl(src)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(src)} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-800" />
              </a>
            ))}
          </div>
        )}
        {p.refs.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{p.refs.map((r, i) => <RefChip key={i} r={r} />)}</div>}
      </div>
    </div>
  )
}

/** 写评论、回复、留言都用这一个：文字、照片，留言区还能引用评论、版本、复制件。 */
export function Composer({ placeholder, onSend, withRefs, autoFocus }: {
  placeholder: string
  onSend: (body: string, files: File[], refs: Ref[]) => Promise<void>
  withRefs?: boolean
  autoFocus?: boolean
}) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [refs, setRefs] = useState<Ref[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const send = async () => {
    if (busy || (!body.trim() && !files.length)) return
    setBusy(true)
    try {
      await onSend(body.trim(), files, refs)
      setBody('')
      setFiles([])
      setRefs([])
    } catch (err) {
      api.notify(String(err instanceof Error ? err.message : err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const addRef = (r: Ref) => {
    setRefs(list => (list.some(x => x.kind === r.kind && String(x.id) === String(r.id)) ? list : [...list, r]))
    setPicking(false)
  }

  return (
    <div className="flex flex-col gap-1.5" data-ui="composer">
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={placeholder} rows={2} autoFocus={autoFocus}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
        className="w-full resize-y bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-teal-500" />
      {(files.length > 0 || refs.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-900 border border-gray-700 px-2 py-0.5 text-[11px] text-gray-200">
              {f.name}<button type="button" className="text-gray-500 hover:text-red-400 cursor-pointer" onClick={() => setFiles(l => l.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {refs.map((r, i) => <RefChip key={i} r={r} onRemove={() => setRefs(l => l.filter((_, j) => j !== i))} />)}
        </div>
      )}
      {picking && withRefs && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-2 max-h-48 overflow-y-auto text-xs flex flex-col gap-0.5" data-ui="ref-picker">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t('collab.ref.pickThread')}</div>
          {collab.threads.filter(th => th.kind === 'pin').map(th => (
            <button key={th.id} type="button" className="text-left truncate rounded px-1.5 py-1 hover:bg-gray-800 cursor-pointer" onClick={() => addRef({ kind: 'thread', id: th.id })}>
              {th.posts[0]?.body || t('collab.pin.untitled')}
            </button>
          ))}
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('collab.ref.pickVersion')}</div>
          {collab.versions.map(v => (
            <button key={v.id} type="button" className="text-left truncate rounded px-1.5 py-1 hover:bg-gray-800 cursor-pointer" onClick={() => addRef({ kind: 'version', id: v.id })}>{v.name}</button>
          ))}
          {collab.myForks.length > 0 && <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{t('collab.ref.pickFork')}</div>}
          {collab.myForks.map(f => (
            <button key={f.id} type="button" className="text-left truncate rounded px-1.5 py-1 hover:bg-gray-800 cursor-pointer" onClick={() => addRef({ kind: 'fork', id: f.id })}>{f.name}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => fileRef.current?.click()} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('collab.attachPhoto')}</button>
        {withRefs && <button type="button" onClick={() => setPicking(p => !p)} className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer">{t('collab.addRef')}</button>}
        <span className="flex-1" />
        <button type="button" disabled={busy || (!body.trim() && !files.length)} onClick={() => void send()} className="qb-btn qb-btn-sm">{t('collab.send')}</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { const list = [...(e.target.files || [])]; setFiles(f => [...f, ...list].slice(0, 9)); e.target.value = '' }} />
    </div>
  )
}
