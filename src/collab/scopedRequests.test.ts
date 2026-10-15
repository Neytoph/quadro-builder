import { describe, expect, it } from 'vitest'
import { ScopedRequests } from './scopedRequests'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('方案请求世代与取消（真实 Promise 时序；不代替浏览器 API 验收）', () => {
  it('A 切 B 后晚到的 A 评论不能覆盖 B，返回 A 也不会接收旧世代', async () => {
    const requests = new ScopedRequests(), A = deferred<string[]>(), B = deferred<string[]>()
    const results: string[][] = []
    let oldSignal!: AbortSignal
    requests.select('A')
    const first = requests.run('A', 'threads', signal => { oldSignal = signal; return A.promise }, value => results.push(value))
    requests.select('B')
    const second = requests.run('B', 'threads', () => B.promise, value => results.push(value))
    expect(oldSignal.aborted).toBe(true)
    B.resolve(['B']); await second
    requests.select('A')
    A.resolve(['old A']); await first
    expect(results).toEqual([['B']])
  })
  it('同一列表只接受最新请求，关闭页面后结果失效', async () => {
    const requests = new ScopedRequests(), old = deferred<number>(), latest = deferred<number>(), closing = deferred<number>()
    const results: number[] = []
    requests.select('A')
    const first = requests.run('A', 'versions', () => old.promise, value => results.push(value))
    const second = requests.run('A', 'versions', () => latest.promise, value => results.push(value))
    latest.resolve(2); await second
    old.resolve(1); await first
    const third = requests.run('A', 'versions', () => closing.promise, value => results.push(value))
    requests.cancel(); closing.resolve(3); await third
    expect(results).toEqual([2])
  })
})
