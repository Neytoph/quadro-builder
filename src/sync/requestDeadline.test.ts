import { describe, expect, it } from 'vitest'
import { withRequestDeadline } from './requestDeadline'

describe('模型请求取消与资源释放', () => {
  it('已经取消时不启动请求', async () => {
    const source = new AbortController(), error = new DOMException('account changed', 'AbortError')
    source.abort(error)
    let started = false
    await expect(withRequestDeadline(source.signal, async () => { started = true })).rejects.toBe(error)
    expect(started).toBe(false)
  })
  it('账号取消会传入正在进行的正文读取', async () => {
    const source = new AbortController(), error = new DOMException('account changed', 'AbortError')
    const pending = withRequestDeadline(source.signal, signal => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    source.abort(error)
    await expect(pending).rejects.toBe(error)
  })
  it('成功后解除父信号监听', async () => {
    const source = new AbortController()
    let observed: AbortSignal | undefined
    expect(await withRequestDeadline(source.signal, async signal => { observed = signal; return 'saved' })).toBe('saved')
    source.abort()
    expect(observed?.aborted).toBe(false)
  })
})
