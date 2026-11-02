import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SceneManager } from '../src/engine/scene.js'
import { BuildModel } from '../src/engine/model.js'
import { loadCatalog } from '../src/engine/catalog.js'
import { carouselBearingForPick } from '../src/engine/carouselBearingModel.js'
import { CarouselRotationGesture } from '../src/engine/carouselRotationGesture.js'

async function main() {
  await loadCatalog()
  const owner = Object.create(SceneManager.prototype)
  Object.assign(owner, { _materials: {}, _keepGeos: new Set() })
  const stage = new THREE.Scene()
  stage.background = new THREE.Color('#fff9f2')
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  document.querySelector('#stage')!.appendChild(renderer.domElement)
  const environment = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environmentTarget = environment.fromScene(room)
  stage.environment = environmentTarget.texture
  room.dispose(); environment.dispose()
  stage.add(new THREE.HemisphereLight('#ffffff', '#cabaa2', 2.4))
  const light = new THREE.DirectionalLight('#ffffff', 4)
  light.position.set(-30, 60, 40); stage.add(light)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  const render = () => renderer.render(stage, camera)
  controls.addEventListener('change', render)
  const part = new THREE.Group()
  part.add(...owner._fittingMeshes({ kind: 'carousel_bearing', x: 0, y: 0, z: 0, quat: [0, 0, 0, 1] }))
  // 展示方向保持轴承正面朝镜头，使用Builder的同一组网格。
  part.rotation.z = -Math.PI / 2
  stage.add(part)
  const model = new BuildModel()
  const response = await fetch('/examples/carousel-bearing.json')
  if (!response.ok) throw new Error('安装示例读取失败')
  if (!model.loadJSON(await response.json()).ok) throw new Error('安装示例模型无效')
  const hidden = document.createElement('div')
  Object.assign(hidden.style, { width: '800px', height: '600px', position: 'fixed', left: '-10000px' })
  document.body.appendChild(hidden)
  const native = new SceneManager(hidden)
  native.setMotion(false); native.setScene(false)
  native.onMeshesReady = () => { native.renderModel(model, null); refreshAssembly() }
  native.renderModel(model, null)
  const assembly = new THREE.Group()
  let mode = 'part'
  function refreshAssembly() {
    assembly.clear()
    native.buildGroup.updateMatrixWorld(true)
    for (const child of native.buildGroup.children) assembly.add(child.clone())
    render()
  }
  refreshAssembly(); assembly.visible = false; stage.add(assembly)
  function fit() {
    const box = new THREE.Box3().setFromObject(mode === 'part' ? part : assembly)
    const center = box.getCenter(new THREE.Vector3()), size = box.getBoundingSphere(new THREE.Sphere()).radius
    const narrow = innerWidth < 600
    const distance = size / Math.sin(THREE.MathUtils.degToRad(15)) * (narrow ? 1.35 : mode === 'part' ? 1.22 : 0.9)
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(new THREE.Vector3(1.1, 1.5, 1.8).normalize(), distance)
    camera.lookAt(center); controls.update(); render()
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    fit()
  }
  const ray = new THREE.Raycaster()
  function pointerRay(x: number, y: number) {
    const rect = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera)
  }
  let drag: CarouselRotationGesture | null = null
  let pointer: number | null = null
  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'mount' || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return
    if (pointer !== null) { finish(true); return }
    pointerRay(e.clientX, e.clientY)
    const hit = ray.intersectObjects(assembly.children, true)[0]
    if (!hit) return
    const id = carouselBearingForPick(model, { ...hit, data: native._hitData(hit) })
    if (!id) return
    controls.enabled = false
    pointer = e.pointerId
    canvas.setPointerCapture(pointer)
    drag = new CarouselRotationGesture(model, id, e.clientX, e.clientY, hit.point, (x, y, origin) => {
      pointerRay(x, y)
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin[1]), new THREE.Vector3())
    })
    e.stopImmediatePropagation()
  }, { capture: true })
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== pointer) return
    drag.update(e.clientX, e.clientY)
    native.renderModel(model, null); refreshAssembly()
  })
  function finish(cancel = false) {
    if (cancel && drag) { drag.cancel(); native.renderModel(model, null); refreshAssembly() }
    drag = null; pointer = null; controls.enabled = true
  }
  canvas.addEventListener('pointerup', e => { if (e.pointerId === pointer) finish() })
  canvas.addEventListener('pointercancel', () => finish(true))
  addEventListener('keydown', e => { if (e.key === 'Escape') finish(true) })
  for (const id of ['part', 'mount']) document.querySelector(`#${id}`)!.addEventListener('click', () => {
    finish(true)
    mode = id; part.visible = id === 'part'; assembly.visible = id === 'mount'
    for (const key of ['part', 'mount']) document.querySelector(`#${key}`)!.setAttribute('aria-pressed', String(key === id))
    document.querySelector('footer')!.textContent = id === 'part' ? '137 × 137 × 52.2 mm · 中心孔 Ø45 mm' : '拖动上部旋转'
    fit()
  })
  addEventListener('resize', resize); resize()
  addEventListener('pagehide', () => {
    controls.dispose(); native.dispose(); hidden.remove()
    environmentTarget.dispose()
    for (const material of Object.values(owner._materials)) (material as THREE.Material).dispose()
    for (const geometry of owner._fitGeos?.values() || []) geometry.dispose()
    renderer.dispose()
  }, { once: true })
}
main().catch(error => { document.querySelector('#error')!.textContent = error.message; console.error(error) })
