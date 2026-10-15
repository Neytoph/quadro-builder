import { beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadCatalog, buildableTubes, panels, geometry } from './catalog.js'
import { BuildModel } from './model.js'
import { parseQDF } from './qdfimport.js'
import { computeAssemblyPlan } from './assemblyPlan.js'
import { Builder } from './builder.js'

beforeAll(async () => { await loadCatalog() })

it.each(['A0001', 'C0179'])('真实 %s 的进度来自已完成的结构与动作，不改变计划', id => {
  const model = new BuildModel()
  const data = parseQDF(readFileSync(`public/qdf/${id}.qdf`, 'utf8'), { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
  expect(model.loadJSON(data).ok).toBe(true)
  const events: any[] = []
  const plan = computeAssemblyPlan(model, {}, 'y+', { onProgress: (...event: any[]) => events.push(event) })
  expect(plan).toEqual(computeAssemblyPlan(model))
  expect(events[0]).toEqual(['structure'])
  const operations = events.filter(([phase]) => phase === 'operations')
  expect(operations.length).toBeGreaterThan(0)
  for (const [, completed, total] of operations) {
    expect(completed).toBeGreaterThan(0)
    expect(completed).toBeLessThanOrEqual(total)
  }
  expect(operations.at(-1)[1]).toBe(operations.at(-1)[2])
}, 120000)

// 仅隔离消息协议，不用它替代真实 Worker 和模型的浏览器验收。
function pendingBuilder() {
  return Object.assign(Object.create(Builder.prototype), {
    mode: 'assembly', _assemblyRequest: 7, _assemblyRequestedKey: 'new-plan',
    assemblyPending: true, assemblyError: false, assemblyProgress: 0,
    assemblyStep: 0, buildPlan: { steps: [] }, onChange: vi.fn(), refresh: vi.fn(),
  })
}

it('消息协议：旧请求、倒退和非法进度不覆盖当前任务，进度不结束等待', () => {
  const builder = pendingBuilder()
  for (const [requestId, progress] of [[6, 80], [7, 40], [7, 20], [7, NaN], [7, 100], [7, -1]]) {
    builder._receiveAssemblyPlan({ type: 'progress', requestId, progress })
  }
  expect(builder.assemblyProgress).toBe(40)
  expect(builder.assemblyPending).toBe(true)
  expect(builder._assemblyRequestedKey).toBe('new-plan')
  expect(builder.onChange).toHaveBeenCalledTimes(1)
  builder.mode = 'select'
  builder._receiveAssemblyPlan({ type: 'progress', requestId: 7, progress: 80 })
  expect(builder.assemblyProgress).toBe(40)
})

it('消息协议：只有结果完成100%，后续进度和重复结果不能覆盖完成状态', () => {
  const builder = pendingBuilder()
  const plan = { steps: [{ id: 'real-result-placeholder' }] }
  builder._receiveAssemblyPlan({ type: 'result', requestId: 7, plan })
  expect(builder.assemblyProgress).toBe(100)
  expect(builder.assemblyPending).toBe(false)
  expect(builder._assemblyPlanKey).toBe('new-plan')
  builder._receiveAssemblyPlan({ type: 'progress', requestId: 7, progress: 80 })
  builder._receiveAssemblyPlan({ type: 'result', requestId: 7, plan: { steps: [] } })
  expect(builder.assemblyProgress).toBe(100)
  expect(builder.buildPlan).toBe(plan)
  expect(builder.refresh).toHaveBeenCalledTimes(1)
})
