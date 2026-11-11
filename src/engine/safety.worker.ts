import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js'
import { computeSafety } from './safety.js'
import type { SafetyOptions } from './safetyTypes'

let ready: Promise<unknown> | null = null
const model = new BuildModel()
self.onmessage = (event: MessageEvent<{ requestId: number; data: unknown; options: SafetyOptions }>) => {
  const { requestId, data, options } = event.data
  ready ??= Promise.all([loadCatalog(), ensureAssemblyMeshes()])
  void ready.then(() => {
    const loaded = model.loadJSON(data)
    if (!loaded.ok) throw new Error(`Safety model load failed: ${loaded.reason}`)
    self.postMessage({ type: 'result', requestId, result: computeSafety(model, options) })
  }).catch((error: unknown) => {
    ready = null
    self.postMessage({ type: 'error', requestId, error: error instanceof Error ? error.message : String(error) })
  })
}
