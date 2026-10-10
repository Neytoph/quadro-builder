import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'
import { getLang, setLang } from './i18n.js'
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js'
import { computeAssemblyPlan } from './assemblyPlan.js'

let ready
let newestRequest = 0

self.addEventListener('message', event => {
  const request = event.data
  if (request?.type !== 'compute') return
  newestRequest = request.requestId
  void compute(request)
})

async function compute(request) {
  try {
    ready ??= Promise.all([loadCatalog(), ensureAssemblyMeshes()]).catch(error => {
      ready = null
      throw error
    })
    await ready
    if (request.requestId !== newestRequest) return
    setLang(request.lang || getLang())
    const model = new BuildModel()
    const loaded = model.loadJSON(request.model)
    if (!loaded.ok) throw new Error(`model load failed: ${loaded.reason}`)
    const plan = computeAssemblyPlan(model, request.config || {}, request.order || 'y+')
    if (request.requestId === newestRequest) self.postMessage({ type: 'result', requestId: request.requestId, plan })
  } catch (error) {
    if (request.requestId === newestRequest) {
      self.postMessage({ type: 'error', requestId: request.requestId, error: String(error?.message || error) })
    }
  }
}
