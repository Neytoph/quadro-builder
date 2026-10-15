import { afterEach, expect, it, vi } from 'vitest'
import { createStatsQueue, type StatsWorker } from './statsQueue'
import type { DesignStats } from '../designStats'

class QueueWorker extends EventTarget {
  postMessage = vi.fn()
  terminate = vi.fn()
  finish(stats: DesignStats) { this.dispatchEvent(new MessageEvent('message', { data: { stats } })) }
}
const stats: DesignStats = { size: [1, 2, 3], steps: 4, height: 2, span: 3, guard: false, floating: 0, errors: [] }
afterEach(() => vi.useRealTimers())

it('Worker契约夹具：挂起任务超时终止并结算，下一任务正常执行', async () => {
  vi.useFakeTimers()
  const workers: QueueWorker[] = []
  const queue = createStatsQueue({ timeoutMs: 20, workerFactory: () => {
    const worker = new QueueWorker(); workers.push(worker); return worker as unknown as StatsWorker
  } })
  const hanging = queue.compute('A', { fixture: 'hang' }).catch(error => error)
  const later = queue.compute('B', { fixture: 'later' })
  await vi.advanceTimersByTimeAsync(20)
  expect((await hanging).message).toContain('timed out')
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  expect(workers).toHaveLength(2)
  workers[1].finish(stats)
  expect(await later).toEqual(stats)
  expect(queue.size()).toBe(0)
})

it('Worker契约夹具：同文档新版本取消旧Worker，主线程缓存同内容结果', async () => {
  const workers: QueueWorker[] = []
  const queue = createStatsQueue({ workerFactory: () => {
    const worker = new QueueWorker(); workers.push(worker); return worker as unknown as StatsWorker
  } })
  const obsolete = queue.compute('doc', { fixture: 'obsolete' }).catch(error => error)
  const currentData = { fixture: 'cache', nodes: [] }
  const current = queue.compute('doc', currentData)
  expect((await obsolete).name).toBe('AbortError')
  expect(workers[0].terminate).toHaveBeenCalledOnce()
  workers[1].finish(stats)
  expect(await current).toEqual(stats)
  expect(await queue.compute('other-doc', currentData)).toEqual(stats)
  expect(workers).toHaveLength(2)
})

it('Worker契约夹具：队列有界，溢出及stop全部结算，无永远等待的模块链', async () => {
  const worker = new QueueWorker()
  const queue = createStatsQueue({ limit: 2, workerFactory: () => worker as unknown as StatsWorker })
  const jobs = ['one', 'two', 'three', 'four'].map(key => queue.compute(key, { fixture: key }).catch(error => error))
  expect(queue.size()).toBe(3)
  expect((await jobs[1]).name).toBe('AbortError')
  queue.cancel()
  expect((await Promise.all(jobs)).every(result => result.name === 'AbortError')).toBe(true)
  expect(queue.size()).toBe(0)
  expect(worker.terminate).toHaveBeenCalledOnce()
})
