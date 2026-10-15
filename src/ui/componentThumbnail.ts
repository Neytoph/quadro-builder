import { BuildModel, SceneManager, loadCatalog } from '../engine-api'
import { FORMAT_VERSION } from '../engine/config.js'
import { waitSceneReady } from '../engine/thumbShot.js'

const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

/** 单独渲染实际片段；串行生成并按完整内容缓存，保留当前 Builder 模型及相机。 */
export function renderComponentThumbnail(key: string): Promise<string> {
  const cached = cache.get(key)
  if (cached) return cached
  const pending = queue.then(async () => {
    await loadCatalog()
    const model = new BuildModel()
    const loaded = model.loadJSON({ ...JSON.parse(key), format: FORMAT_VERSION })
    if (!loaded.ok) throw new Error(`Component model load failed: ${loaded.reason}`)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:256px;height:256px;pointer-events:none'
    host.setAttribute('aria-hidden', 'true')
    document.body.append(host)
    let scene: InstanceType<typeof SceneManager> | null = null
    try {
      scene = new SceneManager(host)
      scene.setMotion(false)
      scene.setScene(false)
      const current = scene
      scene.onMeshesReady = () => current.renderModel(model, null)
      scene.renderModel(model, null)
      if (!await waitSceneReady(scene)) throw new Error('Component meshes timed out')
      scene.renderModel(model, null)
      scene.frameFromYaw(model, 0, { silent: true, aspect: 1, margin: 1.15 })
      const image = scene.snapshot({ hideGrid: true, hideLabels: true, hideRoom: true, width: 256, height: 256, pixelRatio: 1, mime: 'image/png' })
      if (!image?.startsWith('data:image/png')) throw new Error('Component thumbnail capture failed')
      return image
    } finally {
      if (scene) {
        scene.onMeshesReady = () => {}
        scene.dispose()
        scene.renderer!.forceContextLoss()
      }
      host.remove()
    }
  })
  cache.set(key, pending)
  queue = pending.catch(() => { cache.delete(key) })
  if (cache.size > 128) cache.delete(cache.keys().next().value!)
  return pending
}
