import { describe, expect, it } from 'vitest'
import { exportAssemblyPdf } from './assemblyManual.js'
import { waitSceneReady } from './thumbShot.js'

describe('说明书取消', () => {
  it('已取消时在读取模型前结束，不生成 PDF', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(exportAssemblyPdf({ name: 'cancelled', copy: {}, modelJSON: {}, signal: controller.signal })).rejects.toBe(controller.signal.reason)
  })

  it('网格等待在取消后结束并恢复原回调', async () => {
    const controller = new AbortController()
    controller.abort()
    const original = () => undefined
    const scene = { onMeshesReady: original, meshesReady: () => false }
    await expect(waitSceneReady(scene, 20000, controller.signal)).rejects.toBe(controller.signal.reason)
    expect(scene.onMeshesReady).toBe(original)
  })
})
