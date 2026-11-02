import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import './FlexiGuide.css'

export default function FlexiGuide() {
  const api = useEngine()
  const { t } = useI18n()
  const engine = api.engine()
  const target = engine?.builder.flexiTarget()
  const node = target ? engine?.model.nodes.get(target.nodeId) : null
  const bolt = node?.part === 'flexi_bolt' ? node : null
  const hinges = bolt?.hinges?.length ?? 0
  let stage = 'whole'
  if (api.fittingKind === 'flexi_hinge') stage = 'hinge'
  else if (api.fittingKind === 'flexi_bolt') stage = 'bolt'
  if (api.mode === 'select') stage = target?.hinge === null ? 'bolt' : 'hinge'
  const hasMounts = !!engine?.model.boltMounts().length
  let hint = hasMounts ? 'flexi.mountHint' : 'flexi.noEnd'
  if (bolt) hint = hinges ? 'flexi.placedHint' : 'flexi.boltReady'
  if (stage === 'hinge') {
    hint = engine?.model.hingeMounts().length ? 'flexi.hingeHint' : 'flexi.noHingeMount'
    if (bolt && hinges >= 2) hint = 'flexi.noHingeMount'
  }
  if (api.mode === 'select') hint = 'flexi.selectedHint'
  const choose = (kind: string) => {
    if (target && kind === 'flexi_hinge') {
      engine?.builder.addFlexiHinge()
      api.bump()
      return
    }
    // 重新安装时显示所有管端；补铰链时保留刚选中的栓。
    if (engine && kind !== 'flexi_hinge') engine.builder.selectedNodeId = null
    api.setFitting(kind)
  }
  return (
    <section className="qb-flexi-guide qb-card" aria-label={t('flexi.title')}>
      <div className="qb-flexi-heading">
        <strong>{t('flexi.title')}</strong>
        <span>{bolt ? t('flexi.installed', { n: hinges }) : t('flexi.sequence')}</span>
      </div>
      <div className="qb-flexi-options qb-flexi-actions">
        <button type="button" aria-pressed={stage === 'whole'} onClick={() => choose('flexi')}>{t('flexi.whole')}</button>
        <button type="button" aria-pressed={stage === 'bolt'} onClick={() => choose('flexi_bolt')}>{t('flexi.bolt')}</button>
        <button type="button" aria-pressed={stage === 'hinge'} onClick={() => choose('flexi_hinge')}>{t('flexi.hinge')}</button>
        {bolt && <button type="button" className="qb-flexi-depth" onClick={() => { engine?.builder.setFlexiDepth(); api.bump() }}>{t(bolt.boltDeep === 2 ? 'flexi.shallow' : 'flexi.deep')}</button>}
        <button type="button" disabled={!bolt || !hinges} onClick={() => { engine?.builder.connectFlexiTube(); api.bump() }}>{t('flexi.connect')}</button>
      </div>
      <p className="qb-flexi-message" data-kind={api.toast?.kind} role={api.toast?.kind === 'err' || api.toast?.kind === 'warn' ? 'alert' : 'status'}>
        {api.toast?.message || t(hint)}
      </p>
    </section>
  )
}
