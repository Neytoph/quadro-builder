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
  return <section className="qb-card qb-flexi-guide" aria-label={t('clamp.adjustTitle')}>
    <div className="qb-flexi-heading">
      <strong>{t('clamp.adjustTitle')}</strong>
      <div className="qb-flexi-options" role="group" aria-label={t('clamp.adjustMode')}>
        <button type="button" aria-pressed={!slide} onClick={() => { builder.setClampAdjustmentMode('rotate'); api.bump() }}>{t('clamp.rotate')}</button>
        <button type="button" aria-pressed={slide} onClick={() => { builder.setClampAdjustmentMode('slide'); api.bump() }}>{t('clamp.slide')}</button>
        {slide && <>
          <button type="button" aria-label={t('clamp.backward')} onClick={() => { builder.slideSelectedClampBy(-5); api.bump() }}>−5 cm</button>
          <button type="button" aria-label={t('clamp.forward')} onClick={() => { builder.slideSelectedClampBy(5); api.bump() }}>+5 cm</button>
        </>}
      </div>
    </div>
    <p className="qb-flexi-message" data-kind={api.toast?.kind} role={api.toast?.kind === 'warn' ? 'alert' : 'status'}>
      {api.toast?.message || t(slide ? 'clamp.slideHint' : 'clamp.rotateHint')}
    </p>
  </section>
}
