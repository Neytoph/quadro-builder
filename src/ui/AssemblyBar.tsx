import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { AssemblyStatus, useAssemblyStatus } from './AssemblyStatus'
import AssemblyNavigation from './AssemblyNavigation'

/** 画布底下的拼装条：没拼装时查看步骤或导出说明书，拼装时翻步或看全部。 */
export default function AssemblyBar() {
  const api = useEngine()
  const { t } = useI18n()
  const assemblyStatus = useAssemblyStatus(api.assembly)
  const totals = api.bom?.totals
  const hasParts = !!totals && (totals.tubes + totals.connectors + totals.panels + totals.other) > 0
  if (!hasParts && !api.assembly.active) return null
  const n = api.assembly.max + 1

  if (!api.assembly.active) {
    return (
      <div data-tour="assembly" className="m-asm qb-card fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 p-1.5 max-w-[calc(100vw-1rem)]">
        <button onClick={() => api.setAssembly(true)} className="qb-btn qb-btn-ghost qb-btn-sm">{t('asm.steps', { n })}</button>
        <button data-testid="assembly-open-preview" onClick={() => void api.exportAssemblyPdf()} disabled={!!api.exportingManual} className="qb-btn qb-btn-sm">{t('btn.exportManual')}</button>
      </div>
    )
  }

  if (assemblyStatus.visible) {
    return (
      <AssemblyStatus pending={api.assembly.pending} error={api.assembly.error} onWhole={() => api.setAssembly(false)} onRetry={() => api.setAssembly(true)} onStart={assemblyStatus.start} />
    )
  }

  return (
    <AssemblyNavigation step={api.assembly.step} total={n} onStep={api.stepAssembly} onWhole={() => api.setAssembly(false)} showBadge />
  )
}
