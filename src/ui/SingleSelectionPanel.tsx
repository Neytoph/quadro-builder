import {useEngine} from '../store/EngineContext'
import {useI18n} from '../i18n'
import {selectionTransformStrings} from './selectionTransformStrings'
import AccessoryInstallation from './AccessoryInstallation'
import ClampGuide from './ClampGuide'
import FlexiGuide from './FlexiGuide'

export default function SingleSelectionPanel() {
  const api=useEngine(),{lang,t}=useI18n(),s=selectionTransformStrings[lang],builder=api.engine()?.builder
  const adjustment=builder?.selectedPartAdjustment()
  const clamp=builder?.clampAdjustment(),flexi=builder?.flexiTarget()
  const accessory=!!(api.selectedPanelFixing || api.canFlipAccessory || api.installationPreview)
  const id=builder?.selection.keys().next().value
  const panel=id && api.engine()?.model.panels.get(id)
  const canAdjust=adjustment && !flexi && !(panel?.appearanceVersion && panel.panelId==='panel_40x40_pocket')
  const adjust=()=>{builder?.adjustSelectedPart();api.bump()}
  let label:string=s.adjust
  if(adjustment==='panel')label=s.flip
  if(adjustment==='pool')label=s.balls
  if(adjustment==='curve')label=s.curve
  return <section data-ui="single-selection-actions" className="qb-card qb-transform-panel qb-single-actions pointer-events-auto" aria-label={s.single}>
    <div className="qb-single-heading"><strong>{s.single}</strong><button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" onClick={api.selectTransformBlock}>{s.whole}</button></div>
    {accessory && <AccessoryInstallation menuOpen={false} embedded/>}
    {(canAdjust || adjustment==='panel') && <div className="qb-single-buttons">
      {canAdjust && <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" data-ui="adjust-single-part" onClick={adjust}>{label}</button>}
      {adjustment==='panel' && <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" onClick={()=>{builder?.turnSelectedPanel();api.bump()}}>{t('tip.turnPanel')}</button>}
    </div>}
    {clamp && <div data-ui="clamp-guide"><ClampGuide/></div>}
    {flexi && <div data-ui="flexi-guide"><FlexiGuide/></div>}
    <p className="qb-transform-help">{s.multiHint}</p>
  </section>
}
