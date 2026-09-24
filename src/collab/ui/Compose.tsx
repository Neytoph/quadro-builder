import { useRef, useState } from 'react'
import { GitFork, History, Image, MapPin, Quote, Send } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useCollab } from '../CollabContext'
import type { Ref } from '../api'
import { day, errText } from './bits'

/** 引用：位置评论（去看）、版本（对照看）、复制出来的一份（和当前对照）。点了跳过去。 */
export function RefCard({ r, onRemove }: { r: Ref; onRemove?: () => void }) {
  const collab = useCollab()
  const { t, lang } = useI18n()
  let icon = <MapPin />
  let text: React.ReactNode = null
  let go = ''
  let open: (() => void) | null = null
  let cls = ''
  if (r.kind === 'thread') {
    const th = collab.threads.find(x => x.id === Number(r.id))
    text = <>{t('collab.ref.cite')} <b>#{th ? collab.pinNumber(th) : r.id}</b> {(th?.posts[0]?.body || '').slice(0, 24)}</>
    go = t('collab.ref.goPin')
    if (th) open = () => collab.focusThread(th)
  } else if (r.kind === 'version') {
    const v = collab.versions.find(x => x.id === Number(r.id))
    icon = <History />
    text = <><b>{v?.name || r.id}</b>{v ? ` · ${day(v.createdAt, lang)}` : ''}</>
    go = t('collab.ref.goVersion')
    open = () => collab.openCompare(String(r.id), 'current')
  } else {
    const p = collab.myPlans.find(x => x.id === String(r.id))
    icon = <GitFork />
    cls = 'fork'
    text = <b>{p?.name || t('collab.ref.fork')}</b>
    go = t('collab.ref.goFork')
    open = () => collab.openCompare('current', `fork:${r.id}`)
  }
  const card = (
    <button type="button" className={`cb-ref ${cls}`} onClick={open || undefined} data-ui="ref">
      {icon}<span>{text}</span>{!onRemove && <span className="go">{go}</span>}
    </button>
  )
  if (!onRemove) return card
  return <div className="att">{card}<button type="button" className="rm" aria-label="×" onClick={onRemove}>×</button></div>
}

/**
 * 回复、放新图钉、留言共用的输入区：文字、照片，留言区还能引用评论、版本、复制件。
 * 发出去成功才清空；失败原样留着，出错提示。
 */
export function Compose({ placeholder, send, sendLabel, withRefs, autoFocus }: {
  placeholder: string
  send: (body: string, files: File[], refs: Ref[]) => Promise<void>
  sendLabel: string
  withRefs?: boolean
  autoFocus?: boolean
}) {
  const collab = useCollab()
  const { t } = useI18n()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [refs, setRefs] = useState<Ref[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const empty = !body.trim() && !files.length

  const go = async () => {
    if (busy || empty) return
    setBusy(true)
    try {
      await send(body.trim(), files, refs)
      setBody('')
      setFiles([])
      setRefs([])
    } catch (err) {
      collab.report(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const add = (r: Ref) => {
    setRefs(list => (list.some(x => x.kind === r.kind && String(x.id) === String(r.id)) ? list : [...list, r]))
    setPicking(false)
  }

  const pins = collab.threads.filter(th => th.kind === 'pin')
  const forks = collab.myPlans.filter(p => p.role === 'owner' && p.id !== collab.session?.id)

  return (
    <div className="cb-compose" data-ui="composer">
      {refs.map((r, i) => <RefCard key={i} r={r} onRemove={() => setRefs(l => l.filter((_, j) => j !== i))} />)}
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go() } }} />
      {files.length > 0 && (
        <div className="files">
          {files.map((f, i) => <span key={i}>{f.name}<button type="button" onClick={() => setFiles(l => l.filter((_, j) => j !== i))}>×</button></span>)}
        </div>
      )}
      {picking && (
        <div className="cb-picker" data-ui="ref-picker">
          {pins.length > 0 && <div className="h">{t('collab.ref.pickThread')}</div>}
          {pins.map(th => (
            <button key={th.id} type="button" onClick={() => add({ kind: 'thread', id: th.id })}>#{collab.pinNumber(th)} {th.posts[0]?.body}</button>
          ))}
          {collab.versions.length > 0 && <div className="h">{t('collab.ref.pickVersion')}</div>}
          {collab.versions.map(v => <button key={v.id} type="button" onClick={() => add({ kind: 'version', id: v.id })}>{v.name}</button>)}
          {forks.length > 0 && <div className="h">{t('collab.ref.pickFork')}</div>}
          {forks.map(p => <button key={p.id} type="button" onClick={() => add({ kind: 'fork', id: p.id })}>{p.name}</button>)}
          {!pins.length && !collab.versions.length && !forks.length && <div className="h">{t('collab.ref.nothing')}</div>}
        </div>
      )}
      <div className="row">
        <button type="button" className="cb-ib" onClick={() => fileRef.current?.click()}><Image />{t(withRefs ? 'collab.photo' : 'collab.attachPhoto')}</button>
        {withRefs && <button type="button" className="cb-ib" onClick={() => setPicking(p => !p)}><Quote />{t('collab.addRef')}</button>}
        <button type="button" className="qb-btn qb-btn-sm sp" disabled={busy || empty} onClick={() => void go()}>
          {withRefs && <Send />}{sendLabel}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { const list = [...(e.target.files || [])]; setFiles(f => [...f, ...list].slice(0, 9)); e.target.value = '' }} />
    </div>
  )
}
