import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { usePresence } from './motion'
import { Pop } from './Pop'

const ORDER_I18N: Record<string, string> = {
  'y+': 'assembly.orderYp',
  'x+': 'assembly.orderXp',
  'x-': 'assembly.orderXm',
  'z+': 'assembly.orderZp',
  'z-': 'assembly.orderZm',
}

const step = 'h-8 px-3 rounded-full text-[13px] text-gray-100 hover:bg-teal-100 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default whitespace-nowrap'

/** 画布底下的拼装条：没拼装时是「逐层拼装 · N 步」和「导出安装说明书」；拼装时翻步、看全部、换方向。 */
export default function AssemblyBar() {
  const api = useEngine()
  const { t } = useI18n()
  const orderBtn = useRef<HTMLButtonElement>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderShown, orderLeaving] = usePresence(orderOpen ? true : null)
  // 步数往前翻数字往上走，往回翻往下走
  const lastStep = useRef(api.assembly.step)
  const stepDir = api.assembly.step >= lastStep.current ? 'up' : 'down'
  useEffect(() => { lastStep.current = api.assembly.step }, [api.assembly.step])
  const totals = api.bom?.totals
  const hasParts = !!totals && (totals.tubes + totals.connectors + totals.panels + totals.other) > 0
  if (!hasParts && !api.assembly.active) return null
  const n = api.assembly.max + 1

  if (!api.assembly.active) {
    return (
      <div data-tour="assembly" className="m-asm qb-card fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 p-1.5 max-w-[calc(100vw-1rem)]">
        <button onClick={() => api.setAssembly(true)} className="qb-btn qb-btn-ghost qb-btn-sm">{t('asm.steps', { n })}</button>
        <button onClick={() => void api.exportAssemblyPdf()} disabled={!!api.exportingManual} className="qb-btn qb-btn-sm">{t('btn.exportManual')}</button>
      </div>
    )
  }

  return (
    <div data-tour="assembly" className="m-asm qb-card fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none">
      <button onClick={() => api.setAssembly(false)} className="qb-btn qb-btn-sm shrink-0" title={t('assembly.allHint')}>{t('asm.steps', { n })}</button>
      <button disabled={api.assembly.step <= 0} onClick={() => api.stepAssembly(-1)} className={step} title={`${t('assembly.prev')} [`}>‹ {t('assembly.prev')}</button>
      <div className="px-1 text-[13.5px] font-bold qb-num whitespace-nowrap overflow-hidden">
        <span key={api.assembly.step} className="m-tick inline-block" data-dir={stepDir}>{t('assembly.step', { k: api.assembly.step + 1, n })}</span>
      </div>
      <button disabled={api.assembly.step >= api.assembly.max} onClick={() => api.stepAssembly(1)} className={step} title={`${t('assembly.next')} ]`}>{t('assembly.next')} ›</button>
      <button onClick={() => api.setAssembly(false)} className={step} title={t('assembly.allHint')}>{t('assembly.all')}</button>
      <button
        ref={orderBtn}
        type="button"
        id="asm-order"
        aria-haspopup="listbox"
        aria-expanded={orderOpen}
        title={t('assembly.order')}
        onClick={() => setOrderOpen(o => !o)}
        className={`${step} bg-teal-100`}
      >
        {t(ORDER_I18N[api.assembly.order] || api.assembly.order)}
        <span className="ml-1 opacity-60">▾</span>
      </button>
      {orderShown && (
        <Pop anchor={orderBtn.current} leaving={orderLeaving} onClose={() => setOrderOpen(false)} align="right">
          <div className="flex flex-col min-w-[11rem]">
            {api.assemblyOrders.map((order, i) => (
              <button
                key={order}
                style={{ '--i': i } as CSSProperties}
                type="button"
                onClick={() => { api.setAssemblyOrder(order); setOrderOpen(false) }}
                className={`w-full text-left text-[13.5px] rounded-[10px] px-3 py-2 cursor-pointer whitespace-nowrap ${
                  order === api.assembly.order ? 'bg-teal-500 text-white font-bold' : 'text-gray-100 hover:bg-teal-100'}`}
              >
                {t(ORDER_I18N[order] || order)}
              </button>
            ))}
          </div>
        </Pop>
      )}
    </div>
  )
}
