import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import { peerColor } from '../planSession'
import { Avatar } from './PlanBar'

/** 成员：谁在、各自什么角色。创建人能调整角色、移除成员；成员都能生成邀请链接。 */
export default function MembersPane() {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const me = collab.plan?.me
  const owner = collab.role === 'owner'
  const onlineIds = new Set(collab.peers.map(p => p.user?.userId).filter(Boolean))
  const fail = (err: unknown) => api.notify(String(err instanceof Error ? err.message : err), 'err')

  const invite = async () => {
    const url = await collab.inviteUrl()
    await navigator.clipboard.writeText(url)
    api.notify(t('collab.inviteCopied'))
  }

  return (
    <div className="p-3 flex flex-col gap-2" data-ui="members-pane">
      {me && collab.role !== 'guest' && (
        <div className="rounded-xl border border-gray-800 p-3">
          <div className="text-sm text-gray-100">{t('collab.invite')}</div>
          <div className="text-[11px] text-gray-400 mt-0.5 mb-2">{t('collab.inviteHint')}</div>
          <button onClick={() => { void invite().catch(fail) }} className="qb-btn qb-btn-sm" data-ui="members-invite">{t('collab.inviteCopy')}</button>
        </div>
      )}
      {collab.members.map(m => {
        const self = me?.userId === m.userId
        return (
          <div key={m.userId} className="flex items-center gap-2 rounded-xl border border-gray-800 px-3 py-2" data-ui="member" data-user={m.userId}>
            <div className="relative">
              <Avatar name={m.name} avatar={m.avatar} color={peerColor(m.userId)} size={30} />
              {(self || onlineIds.has(m.userId)) && <span className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-teal-400 border-2 border-white" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-100 truncate">{m.name}{self ? ` · ${t('collab.me')}` : ''}</div>
              <div className="text-[11px] text-gray-400">
                {t(`collab.role.${m.role}`)}{m.canDeliver ? ` · ${t('collab.canDeliver')}` : ''}
              </div>
            </div>
            {owner && !self && m.role !== 'owner' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <select value={m.role} onChange={e => { void collab.setRole(m.userId, e.target.value as 'editor' | 'commenter').catch(fail) }}
                  className="bg-gray-800 border border-gray-700 rounded-md text-xs px-1.5 py-1" data-ui="member-role">
                  <option value="editor">{t('collab.role.editor')}</option>
                  <option value="commenter">{t('collab.role.commenter')}</option>
                </select>
                <button onClick={() => { if (window.confirm(t('collab.removeConfirm', { name: m.name }))) void collab.removeMember(m.userId).catch(fail) }}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer">{t('collab.remove')}</button>
              </div>
            )}
          </div>
        )
      })}
      {!me && <div className="text-xs text-gray-400">{t('collab.guestHint')}</div>}
    </div>
  )
}
