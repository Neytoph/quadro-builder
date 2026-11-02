import { useEffect, useState, useSyncExternalStore } from 'react'

// 界面和三维画面的动效。系统里设了「减少动态效果」的人整套都关掉，
// 这时 MOTION 是 false，下面的钩子原样放行，界面和没有动效时一模一样。
const reduced=matchMedia('(prefers-reduced-motion: reduce)')
export let MOTION = !reduced.matches

if (MOTION) document.documentElement.dataset.motion = ''
reduced.addEventListener('change',()=>{MOTION=!reduced.matches;if(MOTION)document.documentElement.dataset.motion='';else delete document.documentElement.dataset.motion})
const subscribe=(change:()=>void)=>{reduced.addEventListener('change',change);return()=>reduced.removeEventListener('change',change)}
export function useMotion(){return useSyncExternalStore(subscribe,()=>!reduced.matches)}

/** 退场动画的时长，和 index.css 里 --m-out 保持一致。 */
const EXIT_MS = 260

/**
 * 关掉的东西多留一会儿，让它演完退场。
 * 返回 [此刻该画的值, 是否正在退场]。value 变成 null 之后，
 * 还会把上一个值再交出去 EXIT_MS 毫秒，同时标记 leaving。
 */
export function usePresence<T>(value: T | null): [T | null, boolean] {
  const motion=useMotion()
  const [last, setLast] = useState<T | null>(value)
  useEffect(() => {
    if (!motion) {setLast(value);return}
    if (value != null) {
      setLast(value)
      return
    }
    const id = window.setTimeout(() => setLast(null), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [value,motion])
  if (!motion) return [value, false]
  if (value != null) return [value, false]
  return [last, last != null]
}
