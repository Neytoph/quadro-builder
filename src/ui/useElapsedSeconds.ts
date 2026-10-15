import { useEffect, useState } from 'react'

export function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const started = Date.now()
    const update = () => setSeconds(Math.floor((Date.now() - started) / 1000))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return seconds
}
