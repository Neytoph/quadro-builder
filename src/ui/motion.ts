import { useEffect, useState } from 'react'

// 界面和三维画面的动效。系统里设了「减少动态效果」的人整套都关掉，
// 这时 MOTION 是 false，下面的钩子原样放行，界面和没有动效时一模一样。
export const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches

if (MOTION) document.documentElement.dataset.motion = ''

/** 退场动画的时长，和 index.css 里 --m-out 保持一致。 */
const EXIT_MS = 260

/**
 * 关掉的东西多留一会儿，让它演完退场。
 * 返回 [此刻该画的值, 是否正在退场]。value 变成 null 之后，
 * 还会把上一个值再交出去 EXIT_MS 毫秒，同时标记 leaving。
 */
export function usePresence<T>(value: T | null): [T | null, boolean] {
  const [last, setLast] = useState<T | null>(value)
  useEffect(() => {
    if (!MOTION) return
    if (value != null) {
      setLast(value)
      return
    }
    const id = window.setTimeout(() => setLast(null), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [value])
  if (!MOTION) return [value, false]
  if (value != null) return [value, false]
  return [last, last != null]
}
