import { afterEach, expect, it } from 'vitest'
import { memoryDoc } from '../collab/localDocs'
import { newModelTarget, pendingNewModel, finishNewModel } from './newModel'

afterEach(() => { location.href = 'http://localhost:3000/' })
it('草稿记录分类和目标位，恢复时不依赖入口参数', () => {
  const local = memoryDoc({ format: 2, nodes: [], tubes: [] })
  location.href = 'http://localhost:3000/?draft=00000000-0000-0000-0000-000000000001&newModelKind=shared&newModelSlot=9'
  expect(newModelTarget(local)?.kind).toBe('shared')
  location.href = 'http://localhost:3000/?draft=00000000-0000-0000-0000-000000000001'
  const target = newModelTarget(local)!
  expect(target.slot).toBe(9)
  const first = pendingNewModel(local, target, '第一次', { format: 2, nodes: [], tubes: [] })
  expect(pendingNewModel(local, target, '重试时已改名', { format: 2, nodes: [], tubes: [] })).toEqual(first)
  finishNewModel(local)
  expect(local.doc.getMap('new-model').has('pending')).toBe(false)
  local.history.destroy(); local.doc.destroy()
})
it('缺失或无效的分类与容量不会被当作新建目标', () => {
  const local = memoryDoc({ format: 2, nodes: [], tubes: [] })
  for (const query of ['newModelKind=share&newModelSlot=-1', 'newModelKind=room&newModelSlot=1', 'newModelKind=shared&newModelSlot=2']) {
    location.href = 'http://localhost:3000/?' + query
    expect(newModelTarget(local)).toBeNull()
  }
  local.history.destroy(); local.doc.destroy()
})
