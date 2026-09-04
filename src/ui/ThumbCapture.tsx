import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { OFFICIAL_MODELS } from '../data/official'
import { MODULES, PRESETS } from '../data/presets'

const PRESET_KEYS = [...MODULES, ...PRESETS].map(p => p.key)

type Listed = { official: string[]; presets: string[] }

export default function ThumbCapture() {
  const { ready, captureThumb, startThumbBatch, endThumbBatch } = useEngine()
  const [active] = useState(() => new URLSearchParams(window.location.search).has('capture-thumbs'))
  const [force] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.get('capture-thumbs') === 'force' || q.has('force')
  })
  const [msg, setMsg] = useState('准备截图…')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!active || !ready) return
    let stop = false
    const timer = window.setTimeout(() => {
      if (stop) return
      void (async () => {
        const listed: Listed = await fetch('/__thumbs/list')
          .then(r => r.ok ? r.json() : { official: [], presets: [] })
          .catch(() => ({ official: [], presets: [] }))
        if (stop) return
        const haveOff = new Set(force ? [] : listed.official)
        const havePre = new Set(force ? [] : listed.presets)
        const jobs: Array<{ kind: 'official' | 'preset'; id: string }> = []
        for (const key of PRESET_KEYS) if (!havePre.has(key)) jobs.push({ kind: 'preset', id: key })
        for (const m of OFFICIAL_MODELS) if (!haveOff.has(m.id)) jobs.push({ kind: 'official', id: m.id })
        if (!jobs.length) {
          setMsg(`已有官方 ${listed.official.length} 张、起步 ${listed.presets.length} 张`)
          setDone(true)
          return
        }
        startThumbBatch()
        let ok = 0
        let fail = 0
        try {
          for (let i = 0; i < jobs.length; i++) {
            if (stop) break
            const job = jobs[i]
            setMsg(`${i + 1}/${jobs.length} ${job.id}`)
            const dataUrl = await captureThumb(job)
            if (!dataUrl) { fail += 1; continue }
            const res = await fetch('/__thumbs/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: job.kind, id: job.id, dataUrl }),
            })
            if (res.ok) ok += 1
            else fail += 1
          }
        } finally {
          endThumbBatch()
        }
        if (!stop) {
          setMsg(`完成：成功 ${ok}，失败 ${fail}`)
          setDone(true)
        }
      })()
    }, 0)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [active, ready, force, captureThumb, startThumbBatch, endThumbBatch])

  if (!active) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] max-w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-gray-700 bg-gray-900/95 text-gray-100 text-sm px-4 py-2.5 shadow-xl tabular-nums">
      {done ? msg : `截图中 ${msg}`}
    </div>
  )
}
