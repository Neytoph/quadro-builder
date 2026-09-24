import { useState } from 'react'
import { Share2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useCollab } from '../CollabContext'
import { Face } from './bits'
import { EnableShareModal, ShareModal } from './Modals'

/**
 * 顶栏最右边：在线成员头像和「共享」按钮。自己的造型没共享时是描边的「共享」，
 * 点了说明怎么共享；共享方案里是实心的「共享 · 人数」，点了看链接和成员。
 * 开源本地版不出现。
 */
export default function ShareCluster() {
  const collab = useCollab()
  const { t } = useI18n()
  const [open, setOpen] = useState<'enable' | 'share' | null>(null)
  if (!collab.enabled || collab.mode === 'delivery' || collab.mode === 'room') return null

  if (collab.mode !== 'plan') {
    return (
      <div className="cb-cluster">
        <button type="button" className="cb-share ghost" onClick={() => setOpen('enable')} data-ui="share-enable"><Share2 /><span>{t('collab.share')}</span></button>
        {open === 'enable' && <EnableShareModal onClose={() => setOpen(null)} />}
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
        <button type="button" className="cb-share" onClick={() => setOpen('share')} data-ui="plan-share">
          <Share2 /><span>{t('collab.shareN', { n: plan.members.length })}</span>
        </button>
      )}
      {open === 'share' && <ShareModal onClose={() => setOpen(null)} />}
    </div>
  )
}
