import { useState } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import { mediaUrl } from '../api'
import { peerColor } from '../planSession'
import { useDock } from '../../ui/dock'

/** 头像：有图用图，没有用名字的第一个字，底色按人固定。 */
export function Avatar({ name, avatar, color, size = 26, ring }: { name: string; avatar?: string; color: string; size?: number; ring?: boolean }) {
  const style = { width: size, height: size, boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined }
  if (avatar) return <img src={mediaUrl(avatar)} alt={name} title={name} className="rounded-full object-cover shrink-0 bg-gray-800" style={style} />
  return (
    <span title={name} className="rounded-full shrink-0 inline-flex items-center justify-center text-white font-semibold select-none"
      style={{ ...style, background: color, fontSize: size * 0.45 }}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export default function PlanBar({ narrow }: { narrow: boolean }) {
  const collab = useCollab()
  const api = useEngine()
  const { t } = useI18n()
  const { setPane } = useDock()
  const [menu, setMenu] = useState(false)
  const s = collab.session
  if (!s) return <div className="flex-1 min-w-0 text-xs text-gray-400">{t('collab.loading')}</div>

  const conn = s.conn === 'connected' ? 'bg-teal-400' : s.conn === 'connecting' ? 'bg-amber-400' : 'bg-gray-500'
  const connText = t(`collab.conn.${s.conn}`)
  const me = collab.plan?.me
  const online = collab.peers.filter(p => p.user)

  const copy = async (text: string, done: string) => {
    await navigator.clipboard.writeText(text)
    api.notify(done)
  }

  const saveVersion = async () => {
    const name = await api.askName(t('collab.version.saveTitle'), t('collab.version.saveOk'), t('collab.version.defaultName', { n: collab.versions.length + 1 }))
    if (!name) return
    try {
      await collab.saveVersion(name)
      api.notify(t('collab.version.saved', { name }))
    } catch (err) {
      api.notify(String(err instanceof Error ? err.message : err), 'err')
    }
  }

  return (
    <div data-ui="plan-bar" className="flex items-center gap-2 min-w-0 flex-1">
      <div className="min-w-0 flex items-center gap-1.5">
        <span className="text-sm font-semibold text-gray-100 truncate max-w-[14rem]" title={s.name}>{s.name}</span>
        <span className="shrink-0 text-[11px] rounded-md px-1.5 py-0.5 bg-gray-800 text-gray-300">{t(`collab.role.${collab.role}`)}</span>
        <span className={`shrink-0 w-2 h-2 rounded-full ${conn}`} title={connText} aria-label={connText} />
        {!narrow && s.conn !== 'connected' && <span className="shrink-0 text-[11px] text-gray-400">{connText}</span>}
      </div>
      <div className="flex items-center -space-x-1.5 shrink-0" data-ui="plan-online">
        {me && <Avatar name={me.name} avatar={me.avatar} color={peerColor(me.userId)} size={24} />}
        {online.slice(0, narrow ? 2 : 6).map(p => (
          <Avatar key={p.clientId} name={p.user!.name} avatar={p.user!.avatar} color={p.user!.color} size={24} ring />
        ))}
        {online.length > (narrow ? 2 : 6) && <span className="text-[11px] text-gray-400 pl-2">+{online.length - (narrow ? 2 : 6)}</span>}
      </div>
      <div className="relative shrink-0">
        <button onClick={() => setMenu(m => !m)} className="qb-btn qb-btn-sm" data-ui="plan-share">{t('collab.share')}</button>
        {menu && (
          <div className="qb-card absolute right-0 top-full mt-1 z-50 w-64 p-2 flex flex-col gap-1 text-sm text-gray-100" onMouseLeave={() => setMenu(false)}>
            <button className="text-left rounded-lg px-2.5 py-2 hover:bg-gray-800 cursor-pointer"
              onClick={() => { setMenu(false); void copy(collab.shareUrl(), t('collab.linkCopied')) }}>
              <div>{t('collab.copyLink')}</div>
              <div className="text-[11px] text-gray-400">{t('collab.copyLinkHint')}</div>
            </button>
            {me && collab.role !== 'guest' && (
              <button className="text-left rounded-lg px-2.5 py-2 hover:bg-gray-800 cursor-pointer" data-ui="plan-invite"
                onClick={() => {
                  setMenu(false)
                  void collab.inviteUrl()
                    .then(url => copy(url, t('collab.inviteCopied')))
                    .catch(err => api.notify(String(err instanceof Error ? err.message : err), 'err'))
                }}>
                <div>{t('collab.invite')}</div>
                <div className="text-[11px] text-gray-400">{t('collab.inviteHint')}</div>
              </button>
            )}
            <button className="text-left rounded-lg px-2.5 py-2 hover:bg-gray-800 cursor-pointer"
              onClick={() => { setMenu(false); setPane('members') }}>{t('collab.pane.members')}</button>
          </div>
        )}
      </div>
      {collab.canEdit && !narrow && (
        <button onClick={() => void saveVersion()} className="qb-btn qb-btn-ghost qb-btn-sm shrink-0" data-ui="plan-save-version">{t('collab.version.save')}</button>
      )}
      {!collab.canEdit && me && collab.role !== 'guest' && !narrow && (
        <button onClick={() => { void collab.fork(null).catch(err => api.notify(String(err instanceof Error ? err.message : err), 'err')) }}
          className="qb-btn qb-btn-ghost qb-btn-sm shrink-0" data-ui="plan-fork">{t('collab.fork')}</button>
      )}
    </div>
  )
}
