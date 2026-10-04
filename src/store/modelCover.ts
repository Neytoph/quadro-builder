import { BuildModel, SceneManager, loadCatalog } from '../engine-api'
import { takeModelThumb, waitSceneReady } from '../engine/thumbShot.js'
import { applyFrameHex, loadTune } from '../engine/colorTune.js'

let queue: Promise<unknown> = Promise.resolve()

/** 独立模型与场景生成保存快照封面；标签切换与实时编辑不会改变这次截图。 */
export function renderModelCover(data: unknown): Promise<string | null> {
  const snapshot = structuredClone(data)
  const run = queue.then(async () => {
    await loadCatalog()
    const model = new BuildModel()
    const loaded = model.loadJSON(snapshot)
    if (!loaded.ok) throw new Error(`cover model load failed: ${loaded.reason}`)
    if (!model.nodes.size) return null
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:360px;pointer-events:none'
    host.setAttribute('aria-hidden', 'true')
    document.body.append(host)
    let scene: InstanceType<typeof SceneManager> | null = null
    try {
      scene = new SceneManager(host)
      scene.setMotion(false)
      scene.setTheme(false)
      scene.setScene(false)
      const tune = loadTune()
      applyFrameHex(tune.frame)
      scene.applyColorTune(tune)
      const current = scene
      scene.onMeshesReady = () => current.renderModel(model, null)
      scene.renderModel(model, null)
      if (!await waitSceneReady(scene)) throw new Error('cover meshes timed out')
      scene.renderModel(model, null)
      return await takeModelThumb(scene, model)
    } finally {
      if (scene) {
        scene.onMeshesReady = () => {}
        scene.dispose()
        scene.renderer!.forceContextLoss()
      }
      host.remove()
    }
  })
  queue = run.then(() => undefined, () => undefined)
  return run
}
