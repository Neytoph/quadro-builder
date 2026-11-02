import type { ReactNode } from 'react'
import { useMotion } from './motion'

/**
 * 左栏卡片的展开收起。动效开着的时候内容一直挂着，高度走 grid 0fr ↔ 1fr，
 * 收起时 inert，键盘和读屏都进不去；动效关着就是「收起即不画」。
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const motion=useMotion()
  if (!motion) return open ? <>{children}</> : null
  return (
    <div className="m-collapse grid min-h-0" data-open={open} inert={!open}>
      <div className="m-collapse-in min-h-0 overflow-hidden flex flex-col">{children}</div>
    </div>
  )
}
