import { useEffect, useRef, useState } from 'react'
import { Users, UserPlus } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useCollab } from '../CollabContext'
import { Face } from './bits'
import { DeliverModal, EnableShareModal, ShareModal } from './Modals'
import { bootEntry, dropParam } from '../../entry'
import { useEngine } from '../../store/EngineContext'

/**
 * 顶栏最右边：普通设计创建共享副本，共享方案查看成员；创建人可以邀请协作。
 * 开源本地版不出现。
 */
export default function ShareCluster() {
  const collab = useCollab()
  const { t } = useI18n()
  const api = useEngine()
  const [open, setOpen] = useState<'enable' | 'share' | 'deliver' | null>(null)
  const createOpened = useRef(false)
  const manageOpened = useRef(false)
  const show = (dialog: 'enable' | 'share' | 'deliver') => { collab.setSharingDialogOpen(true); setOpen(dialog) }
  useEffect(() => {
    if (!collab.enabled || !api.ready || !api.entryReady || createOpened.current || !bootEntry().createShared) return
    if (bootEntry().plan && (collab.plan?.id !== bootEntry().plan || !collab.session?.synced)) return
    createOpened.current = true
    show('enable')
  }, [collab.enabled, api.ready, api.entryReady, collab.plan, collab.session, collab.rev])
  useEffect(() => {
    if (collab.inviteOpenId && collab.plan?.id === collab.inviteOpenId) show('share')
    if (!manageOpened.current && collab.plan && new URLSearchParams(location.search).get('inviteManage') === '1') {
      manageOpened.current = true
      dropParam('inviteManage')
      show('share')
    }
  }, [collab.inviteOpenId, collab.plan])
  const close = () => { setOpen(null); collab.setSharingDialogOpen(false); collab.closeInvite(); dropParam('createShared') }
  const closeCreate = () => { setOpen(null); collab.setSharingDialogOpen(false); dropParam('createShared') }
  if (!collab.enabled || collab.mode === 'delivery' || collab.mode === 'room') return null

  if (collab.mode !== 'plan') {
    return (
      <div className="cb-cluster">
        <button type="button" className="cb-share ghost" title={t('collab.create.action')} aria-label={t('collab.create.action')} onClick={() => show('enable')} data-ui="share-enable"><Users /><span>{t('collab.create.action')}</span></button>
        {collab.createdPlan && <button type="button" className="cb-text-action" onClick={collab.recoverCreatedPlan}>{t('collab.create.recover')}</button>}
        {open === 'enable' && <EnableShareModal onClose={closeCreate} />}
      </div>
    )
  }

  const plan = collab.plan
  const me = plan?.me
  const online = new Set<number>(collab.peers.map(p => p.user?.userId).filter((x): x is number => x != null))
  if (me) online.add(me.userId)
  // 在线的排前面
  const members = [...(plan?.members || [])].sort((a, b) => Number(online.has(b.userId)) - Number(online.has(a.userId)))

  return (
    <div className="cb-cluster" data-ui="plan-cluster">
      <div className="cb-people" data-ui="plan-online">
        {members.slice(0, 5).map(m => (
          <Face key={m.userId} name={m.name} avatar={m.avatar} color={collab.colorOf(m.userId)} state={online.has(m.userId) ? 'on' : 'off'} />
        ))}
        {members.length > 5 && <span className="cb-face more">+{members.length - 5}</span>}
      </div>
      {plan && (
        <button type="button" className="cb-share" title={t(collab.role === 'owner' ? 'collab.create.invite' : 'collab.create.members')} aria-label={t(collab.role === 'owner' ? 'collab.create.invite' : 'collab.create.members')} onClick={() => show('share')} data-ui="plan-share">
          {collab.role === 'owner' ? <UserPlus /> : <Users />}<span>{t(collab.role === 'owner' ? 'collab.create.invite' : 'collab.create.members')}</span>
        </button>
      )}
      {!plan && collab.createdPlan && <button type="button" className="cb-text-action" onClick={collab.recoverCreatedPlan} data-ui="plan-recovery">{t('collab.create.recover')}</button>}
      {open === 'share' && <ShareModal onClose={close} onDeliver={() => { collab.closeInvite(); show('deliver') }} />}
      {open === 'deliver' && <DeliverModal onClose={close} />}
      {open === 'enable' && <EnableShareModal onClose={closeCreate} />}
    </div>
  )
}
