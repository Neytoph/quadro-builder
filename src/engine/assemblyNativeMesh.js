// 碰撞三角面大约 2.5MB，不进启动包。打开搭建、算步骤或保存补步骤数时再加载。
import retryModuleUrl from './assemblyNativeEnvelopes.js?url'
let meshes = null
let pending = null
let retries = 0

export function assemblyMeshes() {
  return meshes
}

export function ensureAssemblyMeshes() {
  if (meshes) return Promise.resolve(meshes)
  // 浏览器会缓存失败的import模块；备用内容hash实体用新的module key重新请求。
  const load = () => retries
    ? import(/* @vite-ignore */ `${retryModuleUrl}?retry=${retries}`)
    : import('./assemblyNativeEnvelopes.js')
  pending ??= load().then(mod => {
    meshes = mod
    return mod
  }).catch(error => {
    pending = null
    retries++
    throw error
  })
  return pending
}
