import { useEffect, useState } from 'react'
import { NARROW_MAX } from './panelLayout'

const query = `(max-width: ${NARROW_MAX}px), (hover: none) and (pointer: coarse)`

export function useMobileControls() {
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return mobile
}
