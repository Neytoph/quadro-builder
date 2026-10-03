import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { BuildModel, SceneManager, loadCatalog, accessories } from '../src/engine-api'
import { builderComponents } from '../src/store/builderComponents'
import { waitSceneReady } from '../src/engine/thumbShot.js'

// 工具页读取真实原生模型，只渲染该模型中的目标组件，不修改 Builder 会话。
export async function renderAccessoryIcons(data: unknown, host: HTMLElement, requestedIds?: string[], options: { outputSize?: number; includeFrame?: boolean; direction?: [number, number, number] } = {}) {
  await loadCatalog()
  const model = new BuildModel()
  const loaded = model.loadJSON(data)
  if (!loaded.ok) throw new Error('缩略图模型读取失败')
  const scene = new SceneManager(host)
  scene.setMotion(false)
  scene.setScene(false)
  scene.onMeshesReady = () => scene.renderModel(model, null)
  scene.renderModel(model, null)
  if (!await waitSceneReady(scene)) throw new Error('真实零件网格加载超时')
  scene.renderModel(model, null)
  scene.buildGroup.updateMatrixWorld(true)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(512, 512, false)
  renderer.outputColorSpace = scene.renderer.outputColorSpace
  renderer.toneMapping = scene.renderer.toneMapping
  renderer.toneMappingExposure = scene.renderer.toneMappingExposure
  const confirmedMaterials = new Set<THREE.Material>(Object.entries(scene._materials).filter(([key]) => key.startsWith('confirmed:')).map(([, material]) => material as THREE.Material))
  let environmentTarget: THREE.WebGLRenderTarget | null = null
  if ([...confirmedMaterials].some(material => material instanceof THREE.MeshPhysicalMaterial && material.envMap)) {
    // 渲染目标纹理属于原 WebGL context；同样环境在资产 renderer 内生成。
    const generator = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    try { environmentTarget = generator.fromScene(room, .04) }
    finally { room.dispose(); generator.dispose() }
  }
  const clonedMaterials = new Map<THREE.Material, THREE.Material>()
  const materialFor = (source: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] => {
    if (Array.isArray(source)) return source.map(material => materialFor(material) as THREE.Material)
    if (!confirmedMaterials.has(source) || !(source instanceof THREE.MeshPhysicalMaterial) || !source.envMap) return source
    const target = environmentTarget
    if (!target) throw new Error('实际组件反射环境未生成')
    if (!clonedMaterials.has(source)) {
      const material = source.clone() as THREE.MeshPhysicalMaterial
      material.envMap = target.texture
      material.needsUpdate = true
      clonedMaterials.set(source, material)
    }
    return clonedMaterials.get(source)!
  }
  const results: Array<{ id: string; url: string; meshes: number; size: number[] }> = []
  const nativeWheels = accessories().filter(part => part.id === 'wheel').map(part => ({ id: part.id, name: part.name, kind: part.qdf, placement: 'fitting' as const }))
  const directory = [...builderComponents(), ...nativeWheels, ...['TA35', 'TA75'].map(id => ({ id, name: id, placement: 'tube' as const }))]
  const targetFor = (part: typeof directory[number]) => [...(part.placement === 'tube' ? model.tubes : part.placement === 'panel' ? model.panels : model.fittings).values()]
    .find(item => (item.tubeId || item.panelId || item.partId || item.kind) === part.id || ('kind' in part && part.kind && item.kind === part.kind))
  const parts = directory.filter(part => requestedIds ? requestedIds.includes(part.id) : !!targetFor(part))
  if (!parts.length) throw new Error('真实模型中没有目录组件')
  if (requestedIds?.some(id => !parts.some(part => part.id === id))) throw new Error('请求的组件 ID 不在真实目录中')
  for (const part of parts) {
    const target = targetFor(part)
    if (!target) throw new Error(`真实模型缺少组件：${part.id}`)
    const stage = new THREE.Scene()
    stage.environment = scene.scene.environment
    scene.scene.traverse(object => { if (object instanceof THREE.Light) stage.add(object.clone()) })
    const tagOf = (object: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = object; p; p = p.parent) if (p.userData.kind) return p.userData
      return null
    }
    let meshes = 0
    scene.buildGroup.traverse(object => {
      if (object instanceof THREE.InstancedMesh && object.userData.instances) {
        object.userData.instances.forEach((instance, index) => {
          if (!options.includeFrame && instance?.id !== target.id) return
          const matrix = new THREE.Matrix4()
          object.getMatrixAt(index, matrix)
          const mesh = new THREE.Mesh(object.geometry, materialFor(object.material))
          mesh.applyMatrix4(matrix.premultiply(object.matrixWorld))
          stage.add(mesh); meshes++
        })
      } else if (object instanceof THREE.Mesh && (options.includeFrame || tagOf(object)?.id === target.id)) {
        const mesh = new THREE.Mesh(object.geometry, materialFor(object.material))
        mesh.applyMatrix4(object.matrixWorld)
        stage.add(mesh); meshes++
      }
    })
    if (!meshes) throw new Error(`真实组件没有可渲染网格：${part.id}`)
    stage.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(stage)
    if (box.isEmpty()) throw new Error(`组件包围盒为空：${part.id}`)
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius
    const camera = new THREE.PerspectiveCamera(28, 1, .1, 100000)
    const direction = new THREE.Vector3(...(options.direction || [1, .8, 1.6])).normalize()
    if (target.quat && ['steering_wheel', 'panel_40x40_basketball', 'panel_40x40_capsule'].includes(part.id)) direction.applyQuaternion(new THREE.Quaternion(...target.quat))
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(14)) * 1.08
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center)
    renderer.setClearColor(0, 0)
    renderer.render(stage, camera)
    const canvas = document.createElement('canvas')
    const outputSize = options.outputSize || 128
    canvas.width = canvas.height = outputSize
    const context = canvas.getContext('2d')
    if (!context) throw new Error('缩略图画布不可用')
    context.imageSmoothingQuality = 'high'
    context.drawImage(renderer.domElement, 0, 0, outputSize, outputSize)
    results.push({ id: part.id, url: canvas.toDataURL('image/png'), meshes, size: box.getSize(new THREE.Vector3()).toArray() })
  }
  for (const material of clonedMaterials.values()) material.dispose()
  environmentTarget?.dispose()
  scene._confirmedEnvironmentTarget?.dispose()
  renderer.forceContextLoss()
  renderer.dispose()
  scene.renderer.forceContextLoss()
  scene.dispose()
  return results
}
