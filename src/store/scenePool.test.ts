// 生命周期隔离检查；真实WebGL与保存行为在浏览器中另行验收。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScenePool } from './scenePool'

const scene = () => ({ dispose: vi.fn(), setPaused: vi.fn(), attachContainer: vi.fn() })
afterEach(() => vi.useRealTimers())
describe('关闭编辑器的有界场景复用', () => {
  it('GPU上下文已经丢失时释放旧场景，允许正常新建', () => {
    const pool = new ScenePool<ReturnType<typeof scene>>(45000), lost = { ...scene(), canReuse: () => false }
    pool.put('7', lost)
    expect(pool.take('7', document.createElement('div'))).toBeNull()
    expect(lost.dispose).toHaveBeenCalledOnce()
  })
  it('同账号取回暂停场景，不跨账号保留GPU资源', () => {
    const pool = new ScenePool<ReturnType<typeof scene>>(45000), first = scene(), host = document.createElement('div')
    pool.put('7', first)
    expect(first.setPaused).toHaveBeenCalledWith(true)
    expect(pool.take('7', host)).toBe(first)
    expect(first.attachContainer).toHaveBeenCalledWith(host)
    expect(first.setPaused).toHaveBeenLastCalledWith(false)
    pool.put('7', first)
    expect(pool.take('8', host)).toBeNull()
    expect(first.dispose).toHaveBeenCalledOnce()
  })
  it('始终只保留一份，空闲到期准确释放且不释放已取回场景', () => {
    vi.useFakeTimers()
    const pool = new ScenePool<ReturnType<typeof scene>>(45000), first = scene(), second = scene()
    pool.put('7', first); pool.put('7', second)
    expect(first.dispose).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(44999)
    expect(second.dispose).not.toHaveBeenCalled()
    expect(pool.take('7', document.createElement('div'))).toBe(second)
    vi.advanceTimersByTime(100000)
    expect(second.dispose).not.toHaveBeenCalled()
    pool.put('7', second); vi.advanceTimersByTime(45000)
    expect(second.dispose).toHaveBeenCalledOnce()
    expect(pool.take('7', document.createElement('div'))).toBeNull()
  })
})
