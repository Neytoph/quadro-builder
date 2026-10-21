import { BufferGeometry, CubeUVReflectionMapping, type Material, type Mesh, type Object3D, type Texture } from 'three'

type DisplayMaterial = Material & { envMap?: Texture | null }

export function usesDisplayEnvironment(material: DisplayMaterial) {
  return material.userData.previewEnvironment === 'room'
    || material.userData.confirmedEnvironment === 'room'
    || material.envMap?.mapping === CubeUVReflectionMapping
}

/** 共享几何只写一次；GPU 环境贴图由预览端重新生成。 */
export function displayObject(source: Object3D) {
  const group = source.clone(true)
  const geometries = new Map<BufferGeometry, BufferGeometry>()
  const materials = new Map<Material, Material>()
  function materialFor(source: DisplayMaterial) {
    if (!materials.has(source)) {
      const material = source.clone() as DisplayMaterial
      material.userData = {}
      if (usesDisplayEnvironment(source) || source.envMap?.isRenderTargetTexture) {
        material.envMap = null
        material.userData.previewEnvironment = 'room'
      }
      materials.set(source, material)
    }
    return materials.get(source)!
  }
  group.traverse(object => {
    object.userData = {}; object.name = ''
    const mesh = object as Mesh
    if (mesh.geometry) {
      if (!geometries.has(mesh.geometry)) {
        const geometry = new BufferGeometry().copy(mesh.geometry)
        geometry.userData = {}
        geometries.set(mesh.geometry, geometry)
      }
      mesh.geometry = geometries.get(mesh.geometry)!
    }
    if (mesh.material) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(materialFor) : materialFor(mesh.material)
  })
  group.updateMatrixWorld(true)
  return group.toJSON()
}
