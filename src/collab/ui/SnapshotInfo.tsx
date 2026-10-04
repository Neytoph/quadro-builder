import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { collabApi, type Version } from '../api'
import { useFlowText } from '../flowStrings'
import { errText, when } from './bits'

export function SnapshotInfo({ planId, versionId }: { planId: string; versionId: number }) {
  const [version, setVersion] = useState<Version | null>(null)
  const [failure, setFailure] = useState('')
  const f = useFlowText()
  const { lang } = useI18n()
  useEffect(() => {
    let active = true
    collabApi.version(planId, versionId).then(value => { if (active) setVersion(value) }).catch(error => { if (active) setFailure(errText(error)) })
    return () => { active = false }
  }, [planId, versionId])
  return <aside className="cb-snapshot-review" data-ui="snapshot-info">
    <b className="cb-snapshot-label">{f('snapshot')}</b>
    <div className="cb-snapshot-info">
      {failure && <p role="alert" className="cb-action-error">{failure}</p>}
      {version && <><h3>{version.name}</h3><small>{when(version.createdAt, lang)}</small></>}
      <p>{f('snapshotHint')}</p>
      <a className="qb-btn qb-btn-ghost qb-btn-sm" href={`?${new URLSearchParams({ plan: planId, lang })}`}>{f('openShared')} ↗</a>
    </div>
  </aside>
}
