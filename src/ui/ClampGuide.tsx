import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import './FlexiGuide.css'

export default function ClampGuide() {
  const api = useEngine()
  const { t } = useI18n()
  const builder = api.engine()?.builder
  const target = builder?.clampAdjustment()
  if (!target) return null
  const slide = target.mode === 'slide'
  const bearing = target.kind === 'bearing'
  const title = t(bearing ? 'bearing.adjustTitle' : 'clamp.adjustTitle')
  const message = api.toast?.message || (!bearing && t(slide ? 'clamp.slideHint' : 'clamp.rotateHint'))
  const setMode = (mode: 'rotate' | 'slide') => {
    if (target.mode === mode || !builder.setClampAdjustmentMode(mode)) return
    api.dismissToast()
    api.bump()
  }
  return <section className="qb-card qb-flexi-guide" aria-label={title}>
    <div className="qb-flexi-heading">
      <strong>{title}</strong>
      <div className="qb-flexi-options" role="group" aria-label={t('clamp.adjustMode')}>
        <button type="button" aria-pressed={!slide} onClick={() => setMode('rotate')}>{t('clamp.rotate')}</button>
        <button type="button" aria-pressed={slide} onClick={() => setMode('slide')}>{t('clamp.slide')}</button>
        {slide && <>
          <button type="button" aria-label={t('clamp.backward')} onClick={() => { builder.slideSelectedClampBy(-5); api.bump() }}>−5 cm</button>
          <button type="button" aria-label={t('clamp.forward')} onClick={() => { builder.slideSelectedClampBy(5); api.bump() }}>+5 cm</button>
        </>}
      </div>
    </div>
    {message && <p className="qb-flexi-message" data-kind={api.toast?.kind} role={api.toast?.kind === 'warn' ? 'alert' : 'status'}>
      {message}
    </p>}
  </section>
}
