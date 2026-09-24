import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Eye, Info, Link, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { UI_ESCAPE_EVENT } from '../../ui/events'
import { isDesigner, useCollab } from '../CollabContext'
import type { Metrics, Role } from '../api'
import { errText, Face, useSignedIn, when } from './bits'

/** 弹层：遮罩加一张卡片，挂到 body 上（从抽屉里打开也不会被框住），Esc 关掉。 */
export function Modal({ onClose, wide, label, children, className }: { onClose: () => void; wide?: boolean; label: string; children: ReactNode; className?: string }) {
  useEffect(() => {
    window.addEventListener(UI_ESCAPE_EVENT, onClose)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onClose)
  }, [onClose])
  return createPortal(
    <div className="cb-mask" onClick={onClose}>
      <div role="dialog" aria-label={label} className={`cb-modal ${className || ''} ${wide ? 'w' : ''} qb-card`} onClick={e => e.stopPropagation()}>
        <button type="button" className="x" aria-label="×" onClick={onClose}>×</button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const ROLES: Role[] = ['owner', 'editor', 'commenter']

/** 自己的造型还没共享：说明三种角色，确认后开启。 */
export function EnableShareModal({ onClose }: { onClose: () => void }) {
  const collab = useCollab()
  const { t } = useI18n()
  const signedIn = useSignedIn()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await collab.enableSharing()
      onClose()
    } catch (err) {
      collab.report(err)
      setBusy(false)
    }
  }
  return (
    <Modal onClose={onClose} label={t('collab.enable.title')}>
      <div data-ui="enable-share">
        <h3>{t('collab.enable.title')}</h3>
        <p className="s">{t('collab.enable.body')}</p>
        <div className="cb-radio">
          {ROLES.map(r => (
            <label key={r} className={`static ${r === 'owner' ? 'on' : ''}`}><i /><span><b>{t(r === 'owner' ? 'collab.enable.you' : `collab.role.${r}`)}</b><br /><span>{t(`collab.roleCan.${r}`)}</span></span><span /></label>
          ))}
        </div>
        <p className="s" style={{ margin: '12px 0 0', fontSize: 12 }}>{t('collab.enable.offline')}</p>
        <div className="foot">
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={onClose}>{t('collab.enable.later')}</button>
          {signedIn
            ? <button type="button" className="qb-btn qb-btn-sm" disabled={busy} onClick={() => void go()} data-ui="enable-share-go">{t('collab.enable.go')}</button>
            : <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline">{t('collab.enable.login')}</a>}
        </div>
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
  const [invite, setInvite] = useState('')
  const [menu, setMenu] = useState<number | null>(null)
  const me = plan?.me
  const owner = collab.role === 'owner'
  const online = new Set(collab.peers.map(p => p.user?.userId).filter(Boolean))

  useEffect(() => {
    if (!me || collab.role === 'guest') return
    collab.inviteUrl().then(setInvite).catch(collab.report)
    // 打开时生成一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(() => api.notify(done)).catch(collab.report)
  }
  const pretty = (url: string) => url.replace(/^https?:\/\//, '')

  if (!plan) return null
  return (
    <Modal onClose={onClose} label={t('collab.share')}>
      <div data-ui="share-modal">
        <h3>{t('collab.shareTitle', { name: collab.session?.name || plan.name })}</h3>
        {me && collab.role !== 'guest' && (
          <>
            <div className="cb-sub" style={{ marginTop: 12 }}>{t('collab.invite')}<span>{t('collab.inviteHint')}</span></div>
            <div className="cb-link"><Link /><code data-ui="invite-url">{invite ? pretty(invite) : '…'}</code>
              <button type="button" className="qb-btn qb-btn-sm" disabled={!invite} onClick={() => copy(invite, t('collab.inviteCopied'))} data-ui="invite-copy">{t('collab.copy')}</button></div>
          </>
        )}
        <div className="cb-sub">{t('collab.viewLink')}<span>{t('collab.viewLinkHint')}</span></div>
        <div className="cb-link"><Eye /><code>{pretty(collab.viewUrl())}</code>
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => copy(collab.viewUrl(), t('collab.linkCopied'))}>{t('collab.copy')}</button></div>
        <div className="cb-sub">{t('collab.membersN', { n: plan.members.length })}{plan.briefId != null && <span>{t('collab.briefPlan')}</span>}</div>
        <div className="cb-members">
          {plan.members.map(m => {
            const self = me?.userId === m.userId
            const designer = isDesigner(plan, m.userId)
            const on = self || online.has(m.userId)
            // 创建人和需求单里接单的设计师：角色固定，只能看
            const fixed = !owner || self || m.role === 'owner' || designer
            const sub = [
              designer ? t('collab.designer') : '',
              on ? t('collab.online') : t('collab.offline'),
              designer ? t('collab.designerLeave') : '',
            ].filter(Boolean).join(' · ')
            return (
              <div key={m.userId} className="cb-mem" data-ui="member" data-user={m.userId}>
                <Face name={m.name} avatar={m.avatar} color={collab.colorOf(m.userId)} state={on ? 'on' : 'off'} />
                <div className="t">
                  <b>{m.name}{self ? t('collab.youSuffix') : ''}{m.canDeliver && <span className="cb-chip dl">{t('collab.canDeliver')}</span>}</b>
                  <span>{sub}</span>
                </div>
                {fixed
                  ? <span className="cb-role fixed">{t(`collab.role.${m.role}`)}</span>
                  : <button type="button" className="cb-role" onClick={() => setMenu(menu === m.userId ? null : m.userId)} data-ui="member-role">{t(`collab.role.${m.role}`)}<ChevronDown /></button>}
                {menu === m.userId && (
                  <div className="cb-menu" data-ui="member-menu">
                    {(['editor', 'commenter'] as const).map(r => (
                      <button key={r} type="button" className={m.role === r ? 'on' : ''}
                        onClick={() => { setMenu(null); collab.setRole(m.userId, r).catch(collab.report) }}>
                        <b>{t(`collab.role.${r}`)}{m.role === r ? ' ✓' : ''}</b><span>{t(`collab.roleMenu.${r}`)}</span>
                      </button>
                    ))}
                    <div className="sep" />
                    <button type="button" className="del" onClick={() => { setMenu(null); collab.removeMember(m.userId).catch(collab.report) }}>
                      <b>{t('collab.remove')}</b><span>{t('collab.removeHint')}</span>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {!me && <p className="s" style={{ marginTop: 12 }}>{t('collab.guestHint')}</p>}
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

  useEffect(() => {
    if (pick == null) return
    setMetrics(null)
    collab.metricsOf(pick).then(setMetrics).catch(collab.report)
  }, [collab, pick])

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
  if (!ask) return null
  const owner = ask.plan.members.find(m => m.role === 'owner')
  const shown = ask.plan.members.slice(0, 2)
  return (
    <Modal onClose={collab.joinAsGuest} label={t('collab.join.title')}>
      <div data-ui="need-login" style={{ textAlign: 'center' }}>
        <div className="cb-people" style={{ justifyContent: 'center', margin: '4px 0 12px' }}>
          {shown.map(m => <Face key={m.userId} name={m.name} avatar={m.avatar} color={collab.colorOf(m.userId)} state="on" size="lg" />)}
          {ask.plan.members.length > 2 && <span className="cb-face lg more">+{ask.plan.members.length - 2}</span>}
        </div>
        <h3 style={{ padding: 0 }}>{t('collab.join.invited', { who: owner?.name || '', name: ask.plan.name })}</h3>
        <p className="s">{t('collab.join.body')}</p>
        <div className="foot" style={{ justifyContent: 'center' }}>
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={collab.joinAsGuest} data-ui="join-guest">{t('collab.join.look')}</button>
          <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline" data-ui="login-join">{t('collab.join.go')}</a>
        </div>
      </div>
    </Modal>
  )
}
