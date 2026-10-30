import { BuildModel } from './model.js';
import { loadCatalog } from './catalog.js';
import { ensureAssemblyMeshes } from './assemblyNativeMesh.js';

let ready;
self.addEventListener('message', event => {
  const request = event.data;
  if (request?.type !== 'compute') return;
  void compute(request);
});

async function compute(request) {
  try {
    ready ??= Promise.all([loadCatalog(), ensureAssemblyMeshes()]);
    await ready;
    const model = new BuildModel();
    const loaded = model.loadJSON(request.model);
    if (!loaded.ok) throw new Error(`Panel model load failed: ${loaded.reason}`);
    const mounts = model.panelAccessoryMounts(request.panelId, request.options);
    self.postMessage({ type: 'result', requestId: request.requestId, mounts });
  } catch (error) {
    self.postMessage({ type: 'error', requestId: request.requestId, error: String(error?.message || error) });
  }
}
