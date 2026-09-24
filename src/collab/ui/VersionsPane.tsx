import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import type { VersionInfo } from '../api'
import { when } from './Posts'
import DeliverDialog from './DeliverDialog'

/**
 * 版本：存版本、挑两个左右对照、从某一版复制一份、锁定交付。
 * 对照可以挑「当前」，也就是大家正在改的这一份。
 */
export default function VersionsPane() {
  const collab = useCollab()
  const api = useEngine()
  const { t, lang } = useI18n()
  const [pick, setPick] = useState<string[]>([])
  const [delivering, setDelivering] = useState<VersionInfo | null>(null)
  const list = [...collab.versions].sort((a, b) => b.createdAt - a.createdAt)
  const nameOf = (userId: number) => collab.members.find(m => m.userId === userId)?.name || ''
  const isMember = collab.role !== 'guest'

  useEffect(() => { collab.refreshVersions().catch(collab.report) }, [collab.refreshVersions, collab.report])

  const toggle = (id: string) => setPick(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id].slice(-2)))
  const fail = (err: unknown) => api.notify(String(err instanceof Error ? err.message : err), 'err')

  const save = async () => {
    const name = await api.askName(t('collab.version.saveTitle'), t('collab.version.saveOk'), t('collab.version.defaultName', { n: collab.versions.length + 1 }))
    if (!name) return
    await collab.saveVersion(name).then(() => api.notify(t('collab.version.saved', { name }))).catch(fail)
  }

  // 对照时旧的在左、新的在右；「当前」算最新
  const openPicked = () => {
    const order = (id: string) => (id === 'current' ? Infinity : (collab.versions.find(v => String(v.id) === id)?.createdAt ?? 0))
    const [a, b] = [...pick].sort((x, y) => order(x) - order(y))
    collab.openCompare(a, b)
  }

  const Row = ({ id, name, sub, v }: { id: string; name: string; sub: string; v: VersionInfo | null }) => (
    <div className={`rounded-xl border px-3 py-2 ${pick.includes(id) ? 'border-teal-500 bg-gray-900' : 'border-gray-800'}`} data-ui="version-row" data-version={id}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={pick.includes(id)} onChange={() => toggle(id)} className="mt-1 accent-orange-500" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-gray-100 truncate">{name}</span>
          <span className="block text-[11px] text-gray-400">{sub}</span>
        </span>
      </label>
      {v && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 pl-6">
          <button className="text-xs text-teal-300 hover:text-teal-100 cursor-pointer" onClick={() => collab.openCompare(String(v.id), 'current')}>{t('collab.version.vsCurrent')}</button>
          {isMember && <button className="text-xs text-gray-400 hover:text-teal-600 cursor-pointer" onClick={() => { void collab.fork(v.id).catch(fail) }}>{t('collab.fork')}</button>}
          {collab.canDeliver && <button className="text-xs text-orange-600 hover:text-orange-500 cursor-pointer" data-ui="version-deliver" onClick={() => setDelivering(v)}>{t('collab.deliver.open')}</button>}
        </div>
      )}
    </div>
  )

  return (
    <div className="p-3 flex flex-col gap-2" data-ui="versions-pane">
      {collab.canEdit && <button onClick={() => void save()} className="qb-btn qb-btn-sm self-start" data-ui="version-save">{t('collab.version.save')}</button>}
      <div className="text-[11px] text-gray-400">{t('collab.version.pickHint')}</div>
      <Row id="current" name={t('collab.current')} sub={t('collab.version.currentSub')} v={null} />
      {list.map(v => (
        <Row key={v.id} id={String(v.id)} name={v.name} sub={`${nameOf(v.createdBy)} · ${when(v.createdAt, lang)}`} v={v} />
      ))}
      {!list.length && <div className="text-xs text-gray-500 py-3 text-center">{t('collab.version.empty')}</div>}
      <button disabled={pick.length !== 2} onClick={openPicked} className="qb-btn qb-btn-sm self-start" data-ui="version-compare">{t('collab.version.compare')}</button>
      {delivering && <DeliverDialog version={delivering} onClose={() => setDelivering(null)} />}
    </div>
  )
}
