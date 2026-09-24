import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { UI_ESCAPE_EVENT } from './events'

/**
 * 挂在某个按钮底下的浮层：工具下拉、文件菜单、装配顺序。
 * 贴着锚点摆，超出窗口就往回挪；点外面或按 Esc 关掉。
 */
export function Pop({ anchor, leaving, onClose, align = 'left', width, className = '', children }: {
  anchor: HTMLElement | null
  leaving: boolean
  onClose?: () => void
  align?: 'left' | 'right' | 'center'
  width?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    // 菜单项按顺序一个接一个进来（错开多少由 CSS 按版本定）
    ref.current?.querySelectorAll<HTMLElement>('button').forEach((b, i) => b.style.setProperty('--i', String(Math.min(i, 12))))
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = el.offsetWidth || 256
      const want = align === 'right' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left
      const left = Math.min(Math.max(8, want), window.innerWidth - w - 8)
      const h = el.offsetHeight || 200
      const top = r.bottom + 6 + h > window.innerHeight - 8 && r.top - h - 6 >= 8
        ? r.top - h - 6
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
  }, [anchor, align])
  useEffect(() => {
    if (!onClose) return
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
      className={`m-pop qb-card fixed z-[60] pointer-events-auto p-2 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-thin ${leaving ? 'm-leave pointer-events-none' : ''} ${className}`}
      style={{ ...pos, width: width ? Math.min(width, window.innerWidth - 16) : undefined }}
    >
      {children}
    </div>,
    document.body,
  )
}
