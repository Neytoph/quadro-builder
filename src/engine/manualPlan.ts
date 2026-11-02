import type { computeAssemblyPlan } from './assemblyPlan.js'

type ManualPlan = ReturnType<typeof computeAssemblyPlan>
type Request = { model: object; config?: object; order?: string; lang: string; signal: AbortSignal; onProgress?: (progress: number) => void }

/** 复用现有装配计算，独立 Worker 使准备阶段可以响应取消。 */
export function requestManualPlan({ model, config = {}, order = 'y+', lang, signal, onProgress }: Request): Promise<ManualPlan> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./assemblyPlan.worker.js', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    worker.addEventListener('error', event => { cleanup(); reject(new Error(event.message || 'Assembly worker failed')) })
    worker.addEventListener('messageerror', () => { cleanup(); reject(new Error('Invalid assembly worker response')) })
    worker.addEventListener('message', event => {
      const message = event.data
      if (message?.requestId !== 1) return
      if (message.type === 'progress') { onProgress?.(message.progress); return }
      cleanup()
      if (message.type === 'result') resolve(message.plan)
      else reject(new Error(message.error || 'Assembly plan failed'))
    })
    try { worker.postMessage({ type: 'compute', requestId: 1, model, config, order, lang }) }
    catch (error) { cleanup(); reject(error) }
  })
}
