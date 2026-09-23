import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { UI_ESCAPE_EVENT } from './events'
import { usePresence } from './motion'
import type { CSSProperties } from 'react'

const ORDER_I18N: Record<string, string> = {
  'y+': 'assembly.orderYp',
  'x+': 'assembly.orderXp',
  'x-': 'assembly.orderXm',
  'z+': 'assembly.orderZp',
  'z-': 'assembly.orderZm',
}

const dropItem = (on: boolean) =>
  `flex items-center w-full text-sm rounded-lg px-3 py-2 text-left cursor-pointer whitespace-nowrap ${
    on ? 'bg-teal-500 text-white font-semibold' : 'text-gray-50 hover:bg-gray-700'
  }`

function OrderMenu({
  anchor,
  value,
  orders,
  onPick,
  onClose,
  leaving,
}: {
  anchor: HTMLElement | null
  value: string
  orders: string[]
  onPick: (id: string) => void
  onClose: () => void
  leaving: boolean
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = el.offsetWidth || 176
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8)
      const h = el.offsetHeight || 200
      const top = r.bottom + 6 + h > window.innerHeight - 8
        ? Math.max(8, r.top - h - 6)
        : r.bottom + 6
      setPos({ top, left })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const node = e.target as Node
      if (ref.current?.contains(node) || anchor?.contains(node)) return
      onClose()
    }
    const onEsc = () => onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={`m-pop fixed z-[60] min-w-[12rem] w-max max-w-[18rem] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-1.5 ${leaving ? 'm-leave pointer-events-none' : ''}`}
      style={pos}
    >
      {orders.map((order, i) => (
        <button
          key={order}
          style={{ '--i': i } as CSSProperties}
          type="button"
          onClick={() => { onPick(order); onClose() }}
          className={dropItem(order === value)}
        >
          {t(ORDER_I18N[order] || order)}
        </button>
      ))}
    </div>,
    document.body,
  )
}

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

  if (!api.assembly.active) {
    return (
      <div data-tour="assembly" className="m-asm fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
        <button onClick={() => api.setAssembly(true)}
          className="bg-gray-900/90 backdrop-blur border border-gray-700 hover:border-teal-400 text-gray-50 text-sm rounded-full shadow-lg px-4 py-2 cursor-pointer">
          {t('assembly.toggle')}
        </button>
      </div>
    )
  }
  const n = api.assembly.max + 1

  return (
    <div data-tour="assembly" className="m-asm fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-gray-900/95 backdrop-blur border border-teal-500/50 rounded-full p-1 shadow-lg">
      <button disabled={api.assembly.step <= 0} onClick={() => api.stepAssembly(-1)}
        className="w-8 h-8 rounded-full text-gray-50 hover:bg-gray-700 disabled:opacity-30 cursor-pointer" title={`${t('assembly.prev')} [`}>◀</button>
      <div className="px-2.5 text-sm font-semibold text-teal-700 tabular-nums whitespace-nowrap overflow-hidden">
        <span key={api.assembly.step} className="m-tick inline-block" data-dir={stepDir}>{t('assembly.step', { k: api.assembly.step + 1, n })}</span>
      </div>
      <button disabled={api.assembly.step >= api.assembly.max} onClick={() => api.stepAssembly(1)}
        className="w-8 h-8 rounded-full text-gray-50 hover:bg-gray-700 disabled:opacity-30 cursor-pointer" title={`${t('assembly.next')} ]`}>▶</button>
      <div className="w-px h-5 bg-gray-700 mx-0.5" />
      <button
        ref={orderBtn}
        type="button"
        id="asm-order"
        aria-haspopup="listbox"
        aria-expanded={orderOpen}
        title={t('assembly.order')}
        onClick={() => setOrderOpen(o => !o)}
        className="h-8 px-3 rounded-full text-sm text-gray-50 hover:bg-gray-700 cursor-pointer whitespace-nowrap"
      >
        {t(ORDER_I18N[api.assembly.order] || api.assembly.order)}
        <span className="ml-1 opacity-60">▾</span>
      </button>
      {orderShown && (
        <OrderMenu
          leaving={orderLeaving}
          anchor={orderBtn.current}
          value={api.assembly.order}
          orders={api.assemblyOrders}
          onPick={api.setAssemblyOrder}
          onClose={() => setOrderOpen(false)}
        />
      )}
      <button onClick={() => api.setAssembly(false)}
        className="px-3 h-8 rounded-full text-sm text-gray-50 hover:bg-gray-700 cursor-pointer" title={t('assembly.allHint')}>{t('assembly.all')}</button>
    </div>
  )
}
