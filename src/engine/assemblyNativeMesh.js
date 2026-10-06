// 碰撞三角面大约 2.5MB，不进启动包。打开搭建、算步骤或保存补步骤数时再加载。
let meshes = null
let pending = null

export function assemblyMeshes() {
  return meshes
}

export function ensureAssemblyMeshes() {
  if (meshes) return Promise.resolve(meshes)
  pending ??= import('./assemblyNativeEnvelopes.js').then(mod => {
    meshes = mod
    return mod
  })
  return pending
}
