import { describe, expect, it, vi } from 'vitest'
import { docs, storage } from '../engine-api'

describe('封面提交与保存版本（内存 IndexedDB，不验证图片成像）', () => {
  it('并发保存原子分配不同版本，旧封面不会抢占最后保存的模型', async () => {
    storage.setAccountScope('concurrent-saved-cover-test')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1800000000000)
    try {
      await docs.saveDoc({ docId: 'same', name: 'base', data: { nodes: [{ id: 'base' }] } })
      const [A, B] = await Promise.all([
        docs.saveDoc({ docId: 'same', name: 'A', data: { nodes: [{ id: 'A' }] } }),
        docs.saveDoc({ docId: 'same', name: 'B', data: { nodes: [{ id: 'B' }] } }),
      ])
      expect(B.updatedAt).toBeGreaterThan(A.updatedAt)
      await docs.setDocCover('same', 'cover-A', A.updatedAt)
      await docs.setDocCover('same', 'cover-B', B.updatedAt)
      const actual = await docs.getDoc('same')
      expect(actual!.name).toBe('B')
      expect(actual!.data).toEqual(B.data)
      expect(actual!.cover).toBe('cover-B')
      expect(actual!.dirty).toBe(true)
    } finally {
      clock.mockRestore()
      storage.setAccountScope(null)
    }
  })

  it('同一毫秒再次保存也使旧封面版本失效，最新封面不被覆盖', async () => {
    storage.setAccountScope('saved-cover-test')
    const A = await docs.saveDoc({ docId: 'A', name: 'A', data: { nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }] } })
    const current = await docs.saveDoc({ docId: 'A', name: 'A', data: { nodes: [{ id: 'n1', x: 120, y: 0, z: 0 }] } })
    expect(current.updatedAt).toBeGreaterThan(A.updatedAt)
    await docs.setDocCover('A', 'data:image/png;base64,new', current.updatedAt)
    await docs.setDocCover('A', 'data:image/png;base64,old', A.updatedAt)
    expect((await docs.getDoc('A'))!.cover).toBe('data:image/png;base64,new')
    expect((await docs.getDoc('A'))!.data).toEqual(current.data)
    storage.setAccountScope(null)
  })
})
