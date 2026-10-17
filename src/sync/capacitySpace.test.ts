import { afterEach, expect, it } from 'vitest'
import { clearSlotAccess, collaborationSpace, saveCapacityFull, slotLocked, updateSlotAccess } from './slotAccess'

afterEach(clearSlotAccess)

it('未读取或切换账号后，不将未知容量误报为已满', () => {
  clearSlotAccess()
  expect(saveCapacityFull()).toBe(false)
  updateSlotAccess([])
  expect(saveCapacityFull()).toBe(true)
  clearSlotAccess()
  expect(saveCapacityFull()).toBe(false)
})

it('其他类别空位不能代替保存容量，已满也不锁住原有模型', () => {
  updateSlotAccess([
    { kind: 'save', active: true, object: { id: 'model', docId: 'document', backend: '1' } },
    { kind: 'share', active: true },
    { kind: 'room', active: true },
  ])
  expect(saveCapacityFull()).toBe(true)
  expect(slotLocked('document')).toBe(false)
})

it('删除释放有效保存容量后恢复新增资格，无效容量不能提供名额', () => {
  updateSlotAccess([{ kind: 'save', active: false }])
  expect(saveCapacityFull()).toBe(true)
  updateSlotAccess([{ kind: 'save', active: true }])
  expect(saveCapacityFull()).toBe(false)
})

it('协作0隐藏创建入口，已有协作占满后也不能再创建，但成员访问不因此锁定', () => {
  clearSlotAccess()
  expect(collaborationSpace()).toBeUndefined()
  updateSlotAccess([])
  expect(collaborationSpace()).toBe(false)
  updateSlotAccess([{ kind: 'shared', active: true, object: { id: 'plan-object', backend: 'plan' } }])
  expect(collaborationSpace()).toBe(false)
  expect(slotLocked(null, undefined, 'plan')).toBe(false)
  updateSlotAccess([{ kind: 'shared', active: true }])
  expect(collaborationSpace()).toBe(true)
})
