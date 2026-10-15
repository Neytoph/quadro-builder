import { cachedStats, rememberStats, statsOfData, type DesignStats } from '../designStats'
import { ensureAssemblyMeshes } from '../engine/assemblyNativeMesh.js'

type Job = { key: string; data: unknown; resolve: (stats: DesignStats) => void; reject: (error: unknown) => void }
export type StatsWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>

/** 单Worker、有界等待；旧内容被取消结算，后续任务不依赖旧promise链。 */
export function createStatsQueue({ limit = 4, timeoutMs = 30_000, workerFactory }:
  { limit?: number; timeoutMs?: number; workerFactory?: () => StatsWorker } = {}) {
  if (limit < 1 || timeoutMs <= 0) throw new Error('invalid stats queue limits')
  let running: Job | null = null
  let cancelRunning: ((error: unknown) => void) | null = null
  const waiting: Job[] = []
  const abortError = () => new DOMException('stats superseded or cancelled', 'AbortError')
  function startNext() {
    if (running || !waiting.length) return
    const job = waiting.shift()!
    running = job
    let worker: StatsWorker | null = null
    let complete = false
    const done = (error?: unknown, stats?: DesignStats | null) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      worker?.terminate()
      running = null
      cancelRunning = null
      if (error || !stats) job.reject(error || new Error('stats model could not be calculated'))
      else { rememberStats(job.data, stats); job.resolve(stats) }
      startNext()
    }
    const timer = setTimeout(() => done(new Error('stats worker timed out')), timeoutMs)
    cancelRunning = error => done(error)
    try {
      if (!workerFactory && typeof Worker !== 'function') {
        // 无Worker的平台保留真实引擎计算，测试也会运行真实模型规划。
        void ensureAssemblyMeshes().then(() => { if (!complete) done(undefined, statsOfData(job.data)) }).catch(done)
      } else {
        worker = workerFactory ? workerFactory() : new Worker(new URL('./statsWorker.ts', import.meta.url), { type: 'module' })
        worker.addEventListener('message', ((event: MessageEvent<{ stats?: DesignStats; error?: string }>) => {
          done(event.data.error ? new Error(event.data.error) : undefined, event.data.stats)
        }) as EventListener)
        worker.addEventListener('error', ((event: ErrorEvent) => done(new Error(event.message))) as EventListener)
        worker.addEventListener('messageerror', (() => done(new Error('stats worker response could not be decoded'))) as EventListener)
        worker.postMessage(job.data)
      }
    } catch (error) { done(error) }
  }
  function cancel(key?: string) {
    for (let index = waiting.length - 1; index >= 0; index--) {
      if (key && waiting[index].key !== key) continue
      waiting.splice(index, 1)[0].reject(abortError())
    }
    if (!key || running?.key === key) cancelRunning?.(abortError())
  }
  function compute(key: string, data: unknown): Promise<DesignStats> {
    cancel(key)
    const hit = cachedStats(data)
    if (hit) return Promise.resolve(hit)
    // 新保存取代同文档旧版本；取消会释放Worker和所有旧等待者。
    return new Promise((resolve, reject) => {
      while (waiting.length >= limit) waiting.shift()!.reject(abortError())
      waiting.push({ key, data: structuredClone(data), resolve, reject })
      startNext()
    })
  }
  return { compute, cancel, size: () => waiting.length + (running ? 1 : 0) }
}
