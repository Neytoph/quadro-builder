import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSafetyAnalysis } from './useSafetyAnalysis'
import { SafetyQueue } from '../engine/safetyQueue'
import type { SafetyResult } from '../engine/safetyTypes'

let host: HTMLDivElement, root: Root, state: ReturnType<typeof useSafetyAnalysis>
const pending: { resolve: (value: SafetyResult) => void; reject: (error: Error) => void }[] = []
const A = JSON.stringify({ format: 2, nodes: [{ id: 'a', x: 0 }] }), B = JSON.stringify({ format: 2, nodes: [{ id: 'b', x: 0 }] })
function Probe({ snapshot, scope = 'tab-a', room = null }: { snapshot: string; scope?: string; room?: { w: number; d: number } | null }) {
  state = useSafetyAnalysis(snapshot, { room, indoor: !!room }, scope)
  return null
}
beforeEach(() => {
  pending.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(SafetyQueue.prototype, 'compute').mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const render = (snapshot: string, scope = 'tab-a', room: { w: number; d: number } | null = null) => act(async () => root.render(createElement(Probe, { snapshot, scope, room })))

describe('安全结果与当前模型绑定', () => {
  it('同数量换模型、切标签和改变房间立即清除旧结论，迟到结果不显示', async () => {
    const disposed = vi.spyOn(SafetyQueue.prototype, 'dispose')
    await render(A); expect(state.safetyPending).toBe(true)
    await render(B)
    await act(async () => pending[0].resolve({ findings: [], height: 100 }))
    expect(state.safety).toBeNull(); expect(state.safetyPending).toBe(true)
    await act(async () => pending[1].resolve({ findings: [], height: 200 }))
    expect(state.safety?.height).toBe(200)
    await render(B, 'tab-b'); expect(state.safety).toBeNull()
    expect(disposed).toHaveBeenCalledOnce()
    await act(async () => pending[2].resolve({ findings: [], height: 200 }))
    await render(B, 'tab-b', { w: 300, d: 400 }); expect(state.safety).toBeNull(); expect(state.safetyPending).toBe(true)
  })
  it('失败不伪装成没有风险，重试成功后恢复当前结果', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await render(A)
    await act(async () => pending[0].reject(new Error('mesh download failed')))
    expect(state.safety).toBeNull(); expect(state.safetyPending).toBe(false); expect(state.safetyError?.message).toContain('mesh')
    await act(async () => state.retrySafety()); expect(state.safetyPending).toBe(true)
    await act(async () => pending[1].resolve({ findings: [], height: 0 }))
    expect(state.safetyError).toBeNull(); expect(state.safetyPending).toBe(false); expect(state.safety).toEqual({ findings: [], height: 0 })
  })
})
