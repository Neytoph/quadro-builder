import { afterEach, describe, expect, it, vi } from 'vitest'
import { SafetyQueue, type SafetyWorker } from './safetyQueue'

// 仅检查消息协议、过期响应和资源释放；真实模型计算与Worker另用Chrome验证。
class ProtocolWorker extends EventTarget implements SafetyWorker {
  messages: { requestId: number }[] = []
  terminated = false
  postMessage(message: { requestId: number }) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply(data: object, request = this.messages.at(-1)!) { this.dispatchEvent(new MessageEvent('message', { data: structuredClone({ requestId: request.requestId, ...data }) })) }
}
const options = { room: null, indoor: false }, data = { nodes: [] }, result = { findings: [], height: 0 }
const queues: SafetyQueue[] = []
const setup = (timeout = 30000) => {
  const workers: ProtocolWorker[] = [], queue = new SafetyQueue(() => { const worker = new ProtocolWorker(); workers.push(worker); return worker }, timeout)
  queues.push(queue); return { queue, workers }
}
afterEach(() => { queues.splice(0).forEach(q => q.dispose()); vi.useRealTimers() })

describe('安全检查后台队列', () => {
  it('连续修改只保留最新等待快照，旧结果不能确认新模型', async () => {
    const { queue, workers } = setup()
    const a = queue.compute('a', data, options).catch(e => e), b = queue.compute('b', data, options).catch(e => e), c = queue.compute('c', data, options)
    expect((await a).name).toBe('AbortError'); expect((await b).name).toBe('AbortError')
    expect(workers[0].messages).toHaveLength(1)
    workers[0].reply({ type: 'result', result })
    expect(workers[0].messages).toHaveLength(2)
    const stale = workers[0].messages[0]
    workers[0].reply({ type: 'result', result: { ...result, height: 900 } }, stale)
    workers[0].reply({ type: 'result', result })
    expect(await c).toEqual(result)
  })
  it('同版本缓存独立复制，切回旧版本不会被稍后返回的模型覆盖', async () => {
    const { queue, workers } = setup(), a = queue.compute('a', data, options)
    workers[0].reply({ type: 'result', result }); const first = await a; first.height = 100
    const b = queue.compute('b', data, options).catch(e => e)
    expect(await queue.compute('a', data, options)).toEqual(result)
    expect((await b).name).toBe('AbortError')
    workers[0].reply({ type: 'result', result: { ...result, height: 10 } })
    expect(await queue.compute('a', data, options)).toEqual(result)
  })
  it.each(['error', 'malformed', 'messageerror', 'timeout'])('%s真实失败状态保留，下一次可新建Worker重试', async failure => {
    vi.useFakeTimers()
    const { queue, workers } = setup(100), p = queue.compute('a', data, options).catch(e => e)
    if (failure === 'error') workers[0].reply({ type: 'error', error: 'mesh unavailable' })
    if (failure === 'malformed') workers[0].reply({ type: 'result', result: { height: 0 } })
    if (failure === 'messageerror') workers[0].dispatchEvent(new Event('messageerror'))
    if (failure === 'timeout') vi.advanceTimersByTime(101)
    expect(await p).toBeInstanceOf(Error); expect(workers[0].terminated).toBe(true)
    const retry = queue.compute('a', data, options)
    workers[0].reply({ type: 'result', result: { ...result, height: 1000 } })
    workers[1].reply({ type: 'result', result }); expect(await retry).toEqual(result)
  })
  it('释放后等待任务均结束，迟到消息和新请求不能复活队列', async () => {
    const { queue, workers } = setup(), p = queue.compute('a', data, options).catch(e => e)
    queue.dispose(); expect((await p).name).toBe('AbortError'); expect(workers[0].terminated).toBe(true)
    workers[0].reply({ type: 'result', result }); await expect(queue.compute('b', data, options)).rejects.toThrow('disposed')
  })
})
