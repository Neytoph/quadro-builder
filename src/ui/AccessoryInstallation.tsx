import { RotateCcw } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { colorLabel, labelOf } from '../names'
import { builderComponents, componentForTool, componentHintKey, componentDimensions } from '../store/builderComponents'
import { NARROW_MAX, statusTipBox, usePanelLayout } from './panelLayout'
import { useDock } from './dock'
import PartThumbnail from './PartThumbnail'

export default function AccessoryInstallation({ menuOpen }: { menuOpen: boolean }) {
  const api = useEngine()
  const { t } = useI18n()
  const { left, right, vw, toolbarW } = usePanelLayout()
  const { pane } = useDock()
  const narrow = vw <= NARROW_MAX
  const preview = api.installationPreview
  const part = preview ? builderComponents().find(p => p.id === preview.partId || p.kind === preview.partId) : componentForTool(api)
  if (menuOpen || (narrow && pane) || (!preview && !part && !api.canFlipAccessory)) return null
  const box = narrow ? null : statusTipBox(left, vw, toolbarW, pane ? right : null)
  if (!narrow && !box) return null

  return <div data-ui="accessory-installation" className={`fixed z-40 flex justify-center pointer-events-none bottom-[68px] ${narrow ? 'left-2 right-2' : ''}`} style={box ? { ...box, top: undefined } : undefined}>
    <section className="qb-card pointer-events-auto max-w-full w-[440px] px-3 py-2.5 text-xs leading-relaxed" aria-label={t('accessory.preview')}>
      {part && <>
        <div className="flex items-center gap-2">
          <PartThumbnail id={part.id} />
          <span className="qb-material-name flex-1 min-w-0">{labelOf(part.id, part.name)}</span>
          {preview && <span className="text-gray-300 shrink-0">{t(preview.mountCount === 1 ? 'accessory.mountOne' : 'accessory.mounts', { n: preview.mountCount })}</span>}
        </div>
        <p className="mt-1 text-gray-300" role="status">{preview?.reason || t(componentHintKey(part), { size: componentDimensions(part) })}</p>
        {api.mode === 'panel' && part.mountLayout === 'opposite-transparent-screws' && <div className="flex items-center flex-wrap gap-1.5 mt-2" role="group" aria-label={t('accessory.fixingEdges')}>
          <span className="mr-1 text-[11px] text-gray-300">{t('accessory.fixingEdges')}</span>
          {(['vertical', 'horizontal'] as const).map(axis => <button type="button" key={axis} className={`qb-btn qb-btn-sm ${api.insetScrewAxis === axis ? '' : 'qb-btn-ghost'}`} data-ui="inset-screw-axis" data-axis={axis} aria-pressed={api.insetScrewAxis === axis} disabled={api.readOnly} onClick={() => api.setInsetScrewAxis(axis)}>{t(`accessory.fixing.${axis}`)}</button>)}
        </div>}
        {part.fixedColor && <p className="mt-1 text-[11px] text-gray-300">{t('accessory.fixedColor', { color: colorLabel(part.fixedColor) })}</p>}
        {(part.assumption || part.id === 'steering_wheel' || part.id === 'panel_40x40_busy' || part.id === 'panel_40x40_pocket' || preview?.assumption) && <p className="mt-1 text-[11px] text-[#9a5b16]">{t('accessory.assumption')}</p>}
      </>}
      {preview && !part && <p role="status">{preview.reason || t('accessory.stage.preview')}</p>}
      {api.canFlipAccessory && <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="qb-btn qb-btn-sm flex items-center gap-1" data-ui="flip-accessory" onClick={api.flipAccessory} disabled={api.readOnly}><RotateCcw size={14} />{t('accessory.flip')}</button>
      </div>}
    </section>
  </div>
}
