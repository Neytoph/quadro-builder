import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Eye, FilePlus2, Info, Link, ShieldCheck, UserPlus } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { UI_ESCAPE_EVENT } from '../../ui/events'
import { isDesigner, useCollab } from '../CollabContext'
import { collabApi, type Invite, type InviteRole, type Metrics } from '../api'
import { bootEntry } from '../../entry'
import { errText, Face, useSignedIn, when } from './bits'

/** 弹层：遮罩加一张卡片，挂到 body 上（从抽屉里打开也不会被框住），Esc 关掉。 */
export function Modal({ onClose, wide, label, children, className }: { onClose: () => void; wide?: boolean; label: string; children: ReactNode; className?: string }) {
  const { holdModal } = useCollab()
  useLayoutEffect(holdModal, [holdModal])
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
    if (!dialog.contains(document.activeElement)) (controls()[0] || dialog).focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0], last = items[items.length - 1]
      if (!first) { event.preventDefault(); dialog.focus(); return }
      if (!dialog.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
    }
    document.addEventListener('keydown', trap, true)
    return () => { document.removeEventListener('keydown', trap, true); if (previousFocus.current?.isConnected) previousFocus.current.focus() }
  }, [])
  useEffect(() => {
    window.addEventListener(UI_ESCAPE_EVENT, onClose)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onClose)
  }, [onClose])
  return createPortal(
    <div className="cb-mask" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} aria-label={label} className={`cb-modal ${className || ''} ${wide ? 'w' : ''} qb-card`} onClick={e => e.stopPropagation()}>
        <button type="button" className="x" aria-label="×" onClick={onClose}>×</button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** 从点击时的造型或者空白创建独立方案。 */
export function EnableShareModal({ onClose }: { onClose: () => void }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const signedIn = useSignedIn()
  const [busy, setBusy] = useState(false)
  const source = api.tabs.find(tab => tab.tabId === api.activeTabId)?.name || ''
  const [blank, setBlank] = useState(bootEntry().blank)
  const initialName = (isBlank: boolean) => Array.from(isBlank ? t('collab.create.blankName') : t('collab.create.copyName', { name: source })).slice(0, 40).join('')
  const [name, setName] = useState(() => initialName(bootEntry().blank))
  const [failure, setFailure] = useState('')
  const pick = (value: boolean) => { setBlank(value); setName(initialName(value)) }
  const go = async () => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try {
      await collab.enableSharing(name, blank)
      onClose()
    } catch (err) {
      setFailure(errText(err))
    } finally { setBusy(false) }
  }
  return (
    <Modal onClose={busy ? () => {} : onClose} label={t('collab.create.title')} className="cb-shared-dialog">
      <div data-ui="enable-share">
        <div className="cb-dialog-icon"><UserPlus /></div>
        <h3>{t('collab.create.title')}</h3>
        <p className="s">{t('collab.create.subtitle')}</p>
        <div className="cb-create-options">
          <button type="button" className={!blank ? 'active' : ''} disabled={busy} onClick={() => pick(false)} aria-pressed={!blank} data-ui="create-copy"><Copy /><b>{t('collab.create.copy')}</b><small>{t('collab.create.copyHint')}</small></button>
          <button type="button" className={blank ? 'active' : ''} disabled={busy} onClick={() => pick(true)} aria-pressed={blank} data-ui="create-blank"><FilePlus2 /><b>{t('collab.create.blank')}</b><small>{t('collab.create.blankHint')}</small></button>
        </div>
        {!blank && <div className="cb-source"><Copy /><div><b>{source}</b><p>{t('collab.create.sourceHint')}</p></div></div>}
        <form onSubmit={e => { e.preventDefault(); void go() }}>
          <label className="cb-field"><span>{t('collab.create.name')}</span><input autoFocus value={name} onChange={e => setName(Array.from(e.target.value).slice(0, 40).join(''))} disabled={busy} required data-ui="create-name" autoComplete="off" /></label>
          <p className="cb-independent"><Copy />{t('collab.create.independent')}</p>
          {failure && <p className="cb-action-error" role="alert">{failure}</p>}
          {collab.createdPlan && <a href={`?plan=${encodeURIComponent(collab.createdPlan.id)}&inviteManage=1`} className="cb-text-action" data-ui="create-recovery">{t('collab.create.recover')}</a>}
          {signedIn
            ? <button type="submit" className="qb-btn cb-wide" disabled={busy || !name.trim() || !api.entryReady} data-ui="enable-share-go">{t(busy ? 'collab.create.creating' : 'collab.create.go')}</button>
            : <a href={collab.loginUrl()} className="qb-btn cb-wide no-underline">{t('collab.create.login')}</a>}
        </form>
      </div>
    </Modal>
  )
}

/** 共享：邀请链接、只看链接、成员和角色。创建人能改别人的角色、移出方案。 */
export function ShareModal({ onClose }: { onClose: () => void }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const plan = collab.plan
  const [invites, setInvites] = useState<Invite[]>([])
  const [tab, setTab] = useState<'invite' | 'members' | 'view'>(collab.role === 'owner' ? 'invite' : 'members')
  const [role, setRole] = useState<InviteRole>('editor')
  const [busy, setBusy] = useState(true)
  const [failure, setFailure] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'disable'; token: string } | { kind: 'remove'; userId: number; name: string } | null>(null)
  const me = plan?.me
  const owner = collab.role === 'owner'
  const online = new Set(collab.peers.map(p => p.user?.userId).filter(Boolean))
  const invite = invites.find(item => item.role === role)

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        await collab.session?.refresh()
        if (owner && plan) {
          const list = await collabApi.invites(plan.id)
          if (!list.length && collab.inviteOpenId === plan.id) list.push(await collabApi.invite(plan.id, 'editor'))
          if (!disposed) setInvites(list)
        }
      } catch (err) { if (!disposed) setFailure(errText(err)) }
      finally { if (!disposed) setBusy(false) }
    })()
    return () => { disposed = true }
  }, [plan?.id, owner, collab.session])

  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setFailure('')
    try { await action() } catch (err) { setFailure(errText(err)) }
    finally { setBusy(false) }
  }
  const generate = () => act(async () => {
    if (!plan || !owner) return
    const next = await collabApi.invite(plan.id, role)
    setInvites(list => [...list.filter(item => item.role !== role), next])
  })

  const inviteURL = invite ? `${location.origin}${location.pathname}?${new URLSearchParams({ plan: plan?.id || '', invite: invite.token })}` : ''
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(() => api.notify(done)).catch(collab.report)
  }
  if (!plan) return null
  const memberRows = (manage: boolean) => <div className="cb-members">{plan.members.map(m => {
    const self = me?.userId === m.userId
    const designer = isDesigner(plan, m.userId)
    const fixed = !manage || self || m.role === 'owner' || designer
    return <div key={m.userId} className="cb-mem" data-ui="member" data-user={m.userId}>
      <Face name={m.name} avatar={m.avatar} color={collab.colorOf(m.userId)} state={self || online.has(m.userId) ? 'on' : 'off'} />
      <div className="t"><b>{m.name}{self ? t('collab.youSuffix') : ''}</b><span>{t(m.role === 'owner' ? 'collab.create.owner' : designer ? 'collab.designer' : self || online.has(m.userId) ? 'collab.online' : 'collab.offline')}</span></div>
      {fixed ? <span className="cb-role lock">{t(`collab.create.role.${m.role}`)}</span> : <div className="cb-member-actions">
        <select className="cb-role-select" value={m.role} disabled={busy} aria-label={t('collab.create.memberRole', { name: m.name })} data-ui="member-role" onChange={e => { const next = e.target.value as InviteRole; void act(() => collab.setRole(m.userId, next)) }}>
          <option value="editor">{t('collab.create.role.editor')}</option><option value="commenter">{t('collab.create.role.commenter')}</option>
        </select>
        <button type="button" className="cb-remove" disabled={busy} aria-label={t('collab.create.removeName', { name: m.name })} data-ui="member-remove" onClick={() => setConfirm({ kind: 'remove', userId: m.userId, name: m.name })}>×</button>
      </div>}
    </div>
  })}</div>
  return (
    <Modal onClose={onClose} label={t(owner ? 'collab.create.invite' : 'collab.create.members')} className="cb-shared-dialog cb-invite-dialog">
      <div data-ui="share-modal">
        <div className="cb-dialog-icon"><UserPlus /></div>
        <h3>{t(owner ? 'collab.create.invite' : 'collab.create.members')}</h3>
        <p className="s">{collab.session?.name || plan.name}</p>
        <div className="cb-modal-tabs" role="tablist">{(owner ? ['invite', 'members', 'view'] as const : ['members'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} data-ui={`share-tab-${key}`} onClick={() => { setTab(key); setConfirm(null) }}>{t(`collab.create.tab.${key}`)}{key === 'members' ? ` · ${plan.members.length}` : ''}</button>)}</div>
        {failure && <div className="cb-action-error" role="alert">{failure}</div>}
        {collab.createdPlan?.id === plan.id && collab.createdPlan.coverError && <div className="cb-action-error" role="alert">{t('collab.create.coverFailed')}<p>{collab.createdPlan.coverError}</p><button type="button" className="cb-text-action" disabled={busy} data-ui="cover-retry" onClick={() => void act(collab.retryCover)}>{t('collab.create.retryCover')}</button></div>}
        {busy && <p className="s" role="status">{t('collab.loading')}</p>}
        {confirm ? <div className="cb-confirm-action">
          <h3>{t(confirm.kind === 'disable' ? 'collab.create.disableTitle' : 'collab.create.removeTitle')}</h3>
          <p className="s">{confirm.kind === 'remove' ? t('collab.create.removeBody', { name: confirm.name }) : t('collab.create.disableBody')}</p>
          <div className="foot"><button type="button" className="qb-btn qb-btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('confirm.cancel')}</button><button type="button" className="qb-btn" disabled={busy} data-ui="confirm-collab-action" onClick={() => void act(async () => {
            if (confirm.kind === 'disable') { await collabApi.disableInvite(plan.id, confirm.token); setInvites(list => list.filter(item => item.token !== confirm.token)) }
            else await collab.removeMember(confirm.userId)
            setConfirm(null)
          })}>{t(confirm.kind === 'disable' ? 'collab.create.disable' : 'collab.remove')}</button></div>
        </div> : tab === 'invite' && owner ? <>
          <div className="cb-invite-banner"><UserPlus /><div><b>{t('collab.create.inviteBanner')}</b><p>{t('collab.create.onlyOwner')}</p></div></div>
          <label className="cb-field-label">{t('collab.create.permission')}</label>
          <div className="cb-role-options">{(['editor', 'commenter'] as const).map(value => <button key={value} type="button" className={role === value ? 'active' : ''} disabled={busy} aria-pressed={role === value} data-ui={`invite-role-${value}`} onClick={() => setRole(value)}>{t(`collab.create.inviteRole.${value}`)}<i /></button>)}</div>
          <p className="s">{t(`collab.create.inviteHint.${role}`)}</p>
          {invite ? <>
            <input className="cb-url-input" readOnly value={inviteURL} aria-label={t('collab.invite')} data-ui="invite-url" />
            <button type="button" className="qb-btn cb-wide" disabled={busy} data-ui="invite-copy" onClick={() => copy(inviteURL, t('collab.inviteCopied'))}><Copy />{t(`collab.create.copyInvite.${role}`)}</button>
            <div className="cb-link-tools"><a className="cb-text-action" href={inviteURL} target="_blank" rel="noreferrer">{t('collab.create.previewInvite')}</a><button type="button" className="cb-text-action danger" disabled={busy} data-ui="invite-disable" onClick={() => setConfirm({ kind: 'disable', token: invite.token })}>{t('collab.create.disable')}</button></div>
          </> : <>
            <div className="cb-status-box">{t('collab.create.noLink')}</div>
            <button type="button" className="qb-btn cb-wide" disabled={busy} data-ui="invite-generate" onClick={() => void generate()}><Link />{t('collab.create.generate')}</button>
          </>}
          <div className="cb-sub">{t('collab.create.joinedMembers')}</div>{memberRows(false)}
          <button type="button" className="cb-text-action" onClick={() => setTab('members')}>{t('collab.create.manageMembers')}</button>
        </> : tab === 'view' && owner ? <div className="cb-view-pane">
          <Eye /><h3>{t('collab.create.viewTitle')}</h3><p className="s">{t('collab.create.viewHint')}</p>
          <input className="cb-url-input" readOnly value={collab.viewUrl()} aria-label={t('collab.viewLink')} data-ui="view-url" />
          <button type="button" className="qb-btn qb-btn-ghost cb-wide" data-ui="view-copy" onClick={() => copy(collab.viewUrl(), t('collab.linkCopied'))}><Copy />{t('collab.create.copyView')}</button>
        </div> : <><p className="s">{t(owner ? 'collab.create.manageHint' : 'collab.create.memberHint')}</p>{memberRows(owner)}</>}
      </div>
    </Modal>
  )
}

/** 复制一份：选一版（或现在），复制成自己的一座，新开一个标签页。 */
export function ForkModal({ onClose }: { onClose: () => void }) {
  const collab = useCollab()
  const { t, lang } = useI18n()
  const own = collab.versions.filter(v => v.kind !== 'reference').sort((a, b) => b.createdAt - a.createdAt)
  const [pick, setPick] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const nameOf = (userId: number) => collab.plan?.members.find(m => m.userId === userId)?.name || ''
  const go = async () => {
    setBusy(true)
    try {
      await collab.fork(pick)
      onClose()
    } catch (err) {
      collab.report(err)
      setBusy(false)
    }
  }
  return (
    <Modal onClose={onClose} label={t('collab.forkTitle')}>
      <div data-ui="fork-modal">
        <h3>{t('collab.forkTitle')}</h3>
        <p className="s">{t('collab.forkBody')}</p>
        <div className="cb-radio">
          <label className={pick === null ? 'on' : ''} onClick={() => setPick(null)}><i /><span><b>{t('collab.version.now')}</b><br /><span>{t('collab.version.nowSub')}</span></span><span className="cb-chip cur">{t('collab.current')}</span></label>
          {own.map(v => (
            <label key={v.id} className={pick === v.id ? 'on' : ''} onClick={() => setPick(v.id)}><i /><span><b>{v.name}</b><br /><span>{nameOf(v.createdBy)} · {when(v.createdAt, lang)}</span></span><span /></label>
          ))}
        </div>
        <div className="foot">
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={onClose}>{t('confirm.cancel')}</button>
          <button type="button" className="qb-btn qb-btn-sm" disabled={busy} onClick={() => void go()} data-ui="fork-go">{t('collab.forkGo')}</button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 锁定交付：选一版，客观量按这一版算好，写适龄和承重说明。已经有交付页时说明旧页面
 * 会提示有更新。锁好以后给出交付页地址（复制出去的链接带来源标记）。
 */
export function DeliverModal({ onClose }: { onClose: () => void }) {
  const collab = useCollab()
  const api = useEngine()
  const { t, lang } = useI18n()
  const own = collab.versions.filter(v => v.kind !== 'reference').sort((a, b) => b.createdAt - a.createdAt)
  const [pick, setPick] = useState<number | null>(own[0]?.id ?? null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [ageNote, setAgeNote] = useState('')
  const [loadNote, setLoadNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const nameOf = (userId: number) => collab.plan?.members.find(m => m.userId === userId)?.name || ''
  const chosen = own.find(v => v.id === pick) || null
  const old = own.find(v => v.delivered && v.id !== pick) || null

  const { metricsOf, report } = collab
  useEffect(() => {
    if (pick == null) return
    setMetrics(null)
    metricsOf(pick).then(setMetrics).catch(report)
  }, [metricsOf, report, pick])

  const url = token ? `${location.origin}/deliver.html?t=${encodeURIComponent(token)}&src=${encodeURIComponent(`delivery:${token}`)}` : ''

  const submit = async () => {
    if (pick == null || !metrics || busy) return
    setBusy(true)
    try {
      setToken(await collab.deliver({ versionId: pick, ageNote: ageNote.trim(), loadNote: loadNote.trim(), metrics }))
    } catch (err) {
      api.notify(errText(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const cell = (label: string, value: ReactNode) => <div><dt>{label}</dt><dd>{value}</dd></div>

  return (
    <Modal onClose={onClose} wide label={t('collab.deliver.title')}>
      <div data-ui="deliver-dialog">
        <h3>{t('collab.deliver.title')}</h3>
        <p className="s">{t('collab.deliver.body')}</p>
        {!token && (
          <>
            <div className="cb-radio">
              {own.map((v, i) => (
                <label key={v.id} className={pick === v.id ? 'on' : ''} onClick={() => setPick(v.id)}><i />
                  <span><b>{v.name}</b><br /><span>{nameOf(v.createdBy)} · {when(v.createdAt, lang)} · {t('collab.parts', { n: v.partsCount })}</span></span>
                  {i === 0 ? <span className="cb-chip cur">{t('collab.deliver.latest')}</span> : v.delivered ? <span className="cb-chip dl">{t('collab.version.delivered')}</span> : <span />}
                </label>
              ))}
            </div>
            <div className="cb-sub">{t('collab.deliver.metrics')}<span>{chosen ? t('collab.deliver.metricsOf', { name: chosen.name }) : ''}</span></div>
            {metrics ? (
              <dl className="cb-metrics" data-ui="deliver-metrics">
                {cell(t('collab.metrics.maxDeckHeight'), <>{metrics.maxDeckHeight}<small>cm</small></>)}
                {cell(t('collab.metrics.maxSpan'), <>{metrics.maxSpan}<small>cm</small></>)}
                {cell(t('collab.metrics.hasGuard'), t(metrics.hasGuard ? 'collab.metrics.yes' : 'collab.metrics.no'))}
                {cell(t('collab.metrics.footprint'), <>{metrics.footprint}<small>㎡</small></>)}
              </dl>
            ) : <div className="cb-hint" style={{ padding: 0 }}>{t('collab.loading')}</div>}
            <label className="cb-field"><span>{t('collab.deliver.ageNote')} <i>{t('collab.deliver.ageHint')}</i></span>
              <textarea value={ageNote} onChange={e => setAgeNote(e.target.value)} data-ui="deliver-age" /></label>
            <label className="cb-field"><span>{t('collab.deliver.loadNote')} <i>{t('collab.deliver.loadHint')}</i></span>
              <textarea value={loadNote} onChange={e => setLoadNote(e.target.value)} data-ui="deliver-load" /></label>
            <div className="cb-warn"><Info /><span>{old ? t('collab.deliver.hasOld', { old: old.name, name: chosen?.name || '' }) : ''}{t('collab.deliver.noShop')}</span></div>
            <div className="foot">
              <span className="note">{t('collab.deliver.disclaimer')}</span>
              <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={onClose}>{t('confirm.cancel')}</button>
              <button type="button" className="qb-btn qb-btn-sm" disabled={!metrics || busy || !ageNote.trim() || !loadNote.trim()} onClick={() => void submit()} data-ui="deliver-submit"><ShieldCheck />{t('collab.deliver.submit')}</button>
            </div>
          </>
        )}
        {token && (
          <div data-ui="deliver-done">
            <div className="cb-sub" style={{ marginTop: 4 }}>{t('collab.deliver.done')}</div>
            <div className="cb-link"><Link /><code>{url.replace(/^https?:\/\//, '')}</code>
              <button type="button" className="qb-btn qb-btn-sm" onClick={() => { navigator.clipboard.writeText(url).then(() => api.notify(t('collab.linkCopied'))).catch(collab.report) }}>{t('collab.copy')}</button></div>
            <input type="hidden" value={url} data-ui="deliver-url" readOnly />
            <div className="foot">
              <a href={url} target="_blank" rel="noreferrer" className="qb-btn qb-btn-ghost qb-btn-sm no-underline">{t('collab.deliver.openPage')}</a>
              <button type="button" className="qb-btn qb-btn-sm" onClick={onClose}>{t('collab.done')}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 打开邀请链接时还没登录：先只看看，或者去登录后加入。 */
export function JoinModal() {
  const collab = useCollab()
  const { t } = useI18n()
  const ask = collab.joinAsk
  if (collab.inviteError) return <Modal onClose={collab.dismissInviteError} label={t('collab.error.title')} className="cb-shared-dialog"><div data-ui="invite-error"><h3>{t('collab.error.title')}</h3><p className="cb-action-error" role="alert">{collab.inviteError}</p><button type="button" className="qb-btn cb-wide" onClick={collab.dismissInviteError}>{t('collab.done')}</button></div></Modal>
  if (!ask) return null
  const shown = ask.plan.members.slice(0, 2)
  return (
    <Modal onClose={collab.joinAsGuest} label={t('collab.join.title')}>
      <div data-ui="need-login" style={{ textAlign: 'center' }}>
        <div className="cb-people" style={{ justifyContent: 'center', margin: '4px 0 12px' }}>
          {shown.map(m => <Face key={m.userId} name={m.name} avatar={m.avatar} color={collab.colorOf(m.userId)} state="on" size="lg" />)}
          {ask.plan.members.length > 2 && <span className="cb-face lg more">+{ask.plan.members.length - 2}</span>}
        </div>
        <h3 style={{ padding: 0 }}>{t('collab.join.invited', { who: ask.info.ownerName, name: ask.info.planName })}</h3>
        <div className="cb-join-role">{t(`collab.create.role.${ask.info.role}`)}</div>
        <p className="s">{t(`collab.create.inviteHint.${ask.info.role}`)}</p>
        <div className="foot" style={{ justifyContent: 'center' }}>
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={collab.joinAsGuest} data-ui="join-guest">{t('collab.join.look')}</button>
          <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline" data-ui="login-join">{t('collab.join.go')}</a>
        </div>
      </div>
    </Modal>
  )
}
