import type { SafetyOptions, SafetyResult } from './safetyTypes'

export type SafetyWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>
type Job = { requestId: number; key: string; data: unknown; options: SafetyOptions; resolve: (result: SafetyResult) => void; reject: (error: Error) => void }
type Reply = { type: string; requestId: number; result?: SafetyResult; error?: string }
const aborted = () => new DOMException('Safety request superseded or cancelled', 'AbortError')

/** 单个后台计算与最新待处理快照；旧结果不进入当前画布。 */
export class SafetyQueue {
  private worker: SafetyWorker | null = null
  private running: Job | null = null
  private waiting: Job | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private requested: Job | null = null
  private sequence = 0
  private disposed = false
  private cache = new Map<string, SafetyResult>()
  private workerFactory: () => SafetyWorker
  private timeoutMs: number

  constructor(workerFactory = (): SafetyWorker => new Worker(new URL('./safety.worker.ts', import.meta.url), { type: 'module' }), timeoutMs = 30_000) {
    this.workerFactory = workerFactory
    this.timeoutMs = timeoutMs
  }

  compute(key: string, data: unknown, options: SafetyOptions): Promise<SafetyResult> {
    if (this.disposed) return Promise.reject(new Error('Safety queue is disposed'))
    this.requested?.reject(aborted())
    this.waiting = null
    const cached = this.cache.get(key)
    if (cached) { this.requested = null; return Promise.resolve(structuredClone(cached)) }
    return new Promise((resolve, reject) => {
      const job = { requestId: ++this.sequence, key, data: structuredClone(data), options: structuredClone(options), resolve, reject }
      this.requested = job
      this.waiting = job
      this.start()
    })
  }

  private start() {
    if (this.disposed || this.running || !this.waiting) return
    const job = this.waiting
    this.waiting = null
    this.running = job
    try {
      if (!this.worker) {
        const worker = this.workerFactory()
        this.worker = worker
        worker.addEventListener('message', ((event: MessageEvent<Reply>) => { if (this.worker === worker) this.complete(event.data) }) as EventListener)
        worker.addEventListener('error', ((event: ErrorEvent) => { if (this.worker === worker) this.fail(new Error(event.message || 'Safety worker failed')) }) as EventListener)
        worker.addEventListener('messageerror', (() => { if (this.worker === worker) this.fail(new Error('Safety response could not be decoded')) }) as EventListener)
      }
      this.timer = setTimeout(() => this.fail(new Error('Safety computation timed out')), this.timeoutMs)
      this.worker.postMessage({ requestId: job.requestId, data: job.data, options: job.options })
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
  }

  private complete(message: Reply) {
    const job = this.running
    if (this.disposed || !job || message.requestId !== job.requestId) return
    if (message.type === 'error') { this.fail(new Error(message.error || 'Safety computation failed')); return }
    const result = message.result
    if (message.type !== 'result' || !result || !Array.isArray(result.findings) || !Number.isFinite(result.height)) {
      this.fail(new Error('Invalid safety response')); return
    }
    this.clearTimer()
    this.running = null
    this.cache.set(job.key, structuredClone(result))
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!)
    if (this.requested === job) { this.requested = null; job.resolve(result) }
    this.start()
  }

  private fail(error: Error) {
    this.clearTimer()
    this.worker?.terminate()
    this.worker = null
    const job = this.running
    this.running = null
    if (job && this.requested === job) { this.requested = null; job.reject(error) }
    this.start()
  }

  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null }

  cancel() {
    this.requested?.reject(aborted())
    this.requested = this.waiting = this.running = null
    this.clearTimer()
    this.worker?.terminate()
    this.worker = null
  }

  dispose() { this.disposed = true; this.cancel(); this.cache.clear() }
}
