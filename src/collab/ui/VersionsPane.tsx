import { useEffect, useMemo, useState } from 'react'
import { Columns2, Save, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEngine } from '../../store/EngineContext'
import { useCollab } from '../CollabContext'
import { diffModels } from '../compare'
import { when } from './bits'
import { DeliverModal } from './Modals'

/**
 * 版本（右侧抽屉）：最上面存版本（编辑者才有），列表里「现在」标当前、锁定过交付的
 * 标「已交付」、参考方案排最后。每行「对照」选两版，底部「对照这两版」；可交付的
 * 编辑者底部多一颗「锁定交付」。
 */
export default function VersionsPane() {
  const collab = useCollab()
  const { tick } = useEngine()
  const { t, lang } = useI18n()
  const [pick, setPick] = useState<string[]>([])
  const own = collab.versions.filter(v => v.kind !== 'reference').sort((a, b) => b.createdAt - a.createdAt)
  const refs = collab.versions.filter(v => v.kind === 'reference')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [sinceLast, setSinceLast] = useState<number | null>(null)
  const nameOf = (userId: number) => collab.plan?.members.find(m => m.userId === userId)?.name || ''

  useEffect(() => { collab.refreshVersions().catch(collab.report) }, [collab.refreshVersions, collab.report])
  useEffect(() => { setName(t('collab.version.defaultName', { n: own.length + 1 })) }, [own.length, t])

  // 「现在」那一行：上次存版本以后改了几件
  const latest = own[0]
  const doc = collab.session
  useEffect(() => {
    if (!latest || !doc) { setSinceLast(null); return }
    let dead = false
    collab.versionModel(String(latest.id)).then((json) => {
      if (dead) return
      const d = diffModels(json, doc.toJSON())
      setSinceLast(d.added.size + d.removed.size + d.changed.size)
    }).catch(collab.report)
    return () => { dead = true }
    // 文档一变就重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, doc, tick])

  const toggle = (id: string) => setPick(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id].slice(-2)))

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await collab.saveVersion(name.trim())
      setName(t('collab.version.defaultName', { n: own.length + 2 }))
    } catch (err) {
      collab.report(err)
    } finally {
      setBusy(false)
    }
  }

  // 旧的在左、新的在右；「现在」最新，参考方案最旧
  const order = useMemo(() => (id: string) => {
    if (id === 'current') return Infinity
    const v = collab.versions.find(x => String(x.id) === id)
    return v ? (v.kind === 'reference' ? -Infinity : v.createdAt) : 0
  }, [collab.versions])
  const compare = () => {
    const [a, b] = [...pick].sort((x, y) => order(x) - order(y))
    collab.openCompare(a, b)
  }

  const Row = ({ id, title, chips, meta, cur }: { id: string; title: string; chips?: React.ReactNode; meta: string; cur?: boolean }) => {
    const on = pick.includes(id)
    return (
      <div className={`cb-ver ${cur ? 'cur' : ''} ${on ? 'pick' : ''}`} data-ui="version-row" data-version={id}>
        <span className="dot" />
        <b>{title}{chips}</b>
        <span className="mt">{meta}</span>
        <span className="acts"><button type="button" className={`cb-mini ${on ? 'on' : ''}`} onClick={() => toggle(id)}>{t(on ? 'collab.version.picked' : 'collab.version.pick')}</button></span>
      </div>
    )
  }

  return (
    <div className="cb-pane" data-ui="versions-pane">
      {collab.canEdit && (
        <>
          <div className="cb-save">
            <input value={name} onChange={e => setName(e.target.value)} aria-label={t('collab.version.nameLabel')} data-ui="version-name"
              onKeyDown={e => { if (e.key === 'Enter') void save() }} />
            <button type="button" className="qb-btn qb-btn-sm" disabled={busy || !name.trim()} onClick={() => void save()} data-ui="version-save"><Save />{t('collab.version.save')}</button>
          </div>
          <p className="cb-hint" style={{ paddingTop: 6 }}>{t('collab.version.saveHint')}</p>
        </>
      )}
      <div className="cb-list" style={{ paddingTop: collab.canEdit ? 0 : 12 }}>
        <Row id="current" cur title={t('collab.version.now')} chips={<span className="cb-chip cur">{t('collab.current')}</span>}
          meta={latest ? (sinceLast == null ? '' : t('collab.version.sinceLast', { n: sinceLast })) : t('collab.version.noneYet')} />
        {own.map(v => (
          <Row key={v.id} id={String(v.id)} title={v.name}
            chips={v.delivered ? <span className="cb-chip dl">{t('collab.version.delivered')}</span> : null}
            meta={`${nameOf(v.createdBy)} · ${when(v.createdAt, lang)} · ${t('collab.parts', { n: v.partsCount })}`} />
        ))}
        {refs.map(v => (
          <Row key={v.id} id={String(v.id)} title={t('collab.version.reference')}
            chips={<span className="cb-chip dl">{t('collab.version.refSource')}</span>}
            meta={`${v.name} · ${when(v.createdAt, lang)} · ${t('collab.parts', { n: v.partsCount })}`} />
        ))}
      </div>
      <div className="cb-dockfoot">
        <span className="note">{pick.length ? t('collab.version.pickedN', { n: pick.length }) : t('collab.version.pickTwo')}</span>
        {collab.canDeliver && own.length > 0 && (
          <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => setDelivering(true)} data-ui="version-deliver"><ShieldCheck />{t('collab.deliver.open')}</button>
        )}
        <button type="button" className="qb-btn qb-btn-sm" disabled={pick.length !== 2} onClick={compare} data-ui="version-compare"><Columns2 />{t('collab.version.compare')}</button>
      </div>
      {delivering && <DeliverModal onClose={() => setDelivering(false)} />}
    </div>
  )
}
