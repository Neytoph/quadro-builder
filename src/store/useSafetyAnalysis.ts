import { useEffect, useRef, useState } from 'react'
import { SafetyQueue } from '../engine/safetyQueue'
import type { SafetyOptions, SafetyResult } from '../engine/safetyTypes'

type Analysis = { key: string; result: SafetyResult | null; error: Error | null }

export function useSafetyAnalysis(snapshot: string | null, options: SafetyOptions, scope: string | null) {
  const queue = useRef<SafetyQueue | null>(null)
  const queueScope = useRef(scope)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [retry, setRetry] = useState(0)
  const optionsKey = JSON.stringify(options)
  const key = snapshot === null ? null : JSON.stringify([scope, optionsKey, snapshot])
  useEffect(() => {
    if (queueScope.current !== scope) {
      queue.current?.dispose(); queue.current = null; queueScope.current = scope
    }
    if (key === null || snapshot === null) { queue.current?.cancel(); return }
    let active = true
    const current = queue.current ??= new SafetyQueue()
    void current.compute(key, JSON.parse(snapshot), JSON.parse(optionsKey)).then(result => {
      if (active) setAnalysis({ key, result, error: null })
    }).catch((error: unknown) => {
      if (!active || error instanceof DOMException && error.name === 'AbortError') return
      const failure = error instanceof Error ? error : new Error(String(error))
      console.error('[safety]', failure)
      setAnalysis({ key, result: null, error: failure })
    })
    return () => { active = false }
  }, [key, snapshot, optionsKey, scope, retry])
  useEffect(() => () => { queue.current?.dispose(); queue.current = null }, [])
  const current = key !== null && analysis?.key === key ? analysis : null
  return {
    safety: current?.result ?? null,
    safetyPending: key !== null && !current,
    safetyError: current?.error ?? null,
    retrySafety: () => { setAnalysis(null); setRetry(n => n + 1) },
  }
}
