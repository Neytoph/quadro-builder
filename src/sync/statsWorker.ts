import { loadCatalog } from '../engine/catalog.js'
import { ensureAssemblyMeshes } from '../engine/assemblyNativeMesh.js'
import { statsOfData, type DesignStats } from '../designStats'

let ready: Promise<unknown> | null = null

self.onmessage = (event: MessageEvent<unknown>) => {
  ready ??= Promise.all([loadCatalog(), ensureAssemblyMeshes()])
  ready.then(() => {
    const stats = statsOfData(event.data)
    self.postMessage({ stats })
  }).catch((error: unknown) => {
    ready = null
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ stats: null as DesignStats | null, error: message })
  })
}
