import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'

const ORDER_I18N: Record<string, string> = {
  'y+': 'assembly.orderYp',
  'x+': 'assembly.orderXp',
  'x-': 'assembly.orderXm',
  'z+': 'assembly.orderZp',
  'z-': 'assembly.orderZm',
}

export default function AssemblyBar() {
  const api = useEngine()
  const { t } = useI18n()
  const totals = api.bom?.totals
  const hasParts = !!totals && (totals.tubes + totals.connectors + totals.panels + totals.other) > 0
  if (!hasParts && !api.assembly.active) return null

  if (!api.assembly.active) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
        <button onClick={() => api.setAssembly(true)}
          className="bg-gray-900/90 backdrop-blur border border-gray-700 hover:border-teal-400 text-gray-200 text-sm rounded-full shadow-lg px-4 py-2 cursor-pointer">
          {t('assembly.toggle')}
        </button>
      </div>
    )
  }
  const n = api.assembly.max + 1

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-gray-900/95 backdrop-blur border border-teal-500/50 rounded-full p-1 shadow-lg">
      <button disabled={api.assembly.step <= 0} onClick={() => api.stepAssembly(-1)}
        className="w-8 h-8 rounded-full text-gray-200 hover:bg-gray-700 disabled:opacity-30 cursor-pointer" title={`${t('assembly.prev')} [`}>◀</button>
      <div className="px-2 text-sm text-teal-200 tabular-nums">{t('assembly.step', { k: api.assembly.step + 1, n })}</div>
      <button disabled={api.assembly.step >= api.assembly.max} onClick={() => api.stepAssembly(1)}
        className="w-8 h-8 rounded-full text-gray-200 hover:bg-gray-700 disabled:opacity-30 cursor-pointer" title={`${t('assembly.next')} ]`}>▶</button>
      <div className="w-px h-5 bg-gray-700 mx-0.5" />
      <label className="sr-only" htmlFor="asm-order">{t('assembly.order')}</label>
      <select id="asm-order" value={api.assembly.order}
        onChange={e => api.setAssemblyOrder(e.target.value)}
        className="h-8 max-w-[7.5rem] rounded-full bg-gray-800 text-gray-200 text-[11px] px-2 border-0 cursor-pointer">
        {api.assemblyOrders.map(order => (
          <option key={order} value={order}>{t(ORDER_I18N[order] || order)}</option>
        ))}
      </select>
      <button onClick={() => api.setAssembly(false)}
        className="px-3 h-8 rounded-full text-xs text-gray-300 hover:bg-gray-700 cursor-pointer" title={t('assembly.allHint')}>{t('assembly.all')}</button>
    </div>
  )
}
