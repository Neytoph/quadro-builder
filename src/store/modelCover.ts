import { BuildModel, SceneManager, loadCatalog } from '../engine-api'
import { waitSceneReady } from '../engine/thumbShot.js'
import { applyFrameHex, loadTune } from '../engine/colorTune.js'
import { Color, MeshBasicMaterial, Raycaster, Vector2, Vector3, type Mesh, type Object3D } from 'three'

let queue: Promise<unknown> = Promise.resolve()

function frameCover(scene: InstanceType<typeof SceneManager>, model: InstanceType<typeof BuildModel>, bounds: {min:number[];max:number[]}) {
  const options={silent:true,aspect:4/3,margin:1.12,elevate:.25,bounds:{...bounds,size:bounds.max.map((n,axis)=>n-bounds.min[axis])}}
  if (!scene._homeGroup?.visible) {scene.frameFromYaw(model,0,options);return}
  const ray=new Raycaster(),point=new Vector2()
  // 用真实几何检查家具遮挡，只调整取景方向，不改变造型与房间的位置。
  let bestYaw=0,bestScore=-1
  for (const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
    scene.frameFromYaw(model,yaw,options)
    scene._homeGroup.userData.updateWalls(scene.camera)
    scene.scene.updateMatrixWorld(true);scene.camera.updateMatrixWorld(true)
    let score=0
    for(let x=0;x<10;x++)for(let y=0;y<10;y++){
      ray.setFromCamera(point.set((x+.5)/10*1.6-.8,(y+.5)/10*1.6-.8),scene.camera)
      for(const hit of ray.intersectObjects([scene.buildGroup,scene._homeGroup],true)){
        const mesh=hit.object as Mesh
        if(!mesh.isMesh)continue
        let visible=true,isModel=false
        for(let object:Object3D|null=mesh;object;object=object.parent){if(!object.visible)visible=false;if(object===scene.buildGroup)isModel=true}
        const material=Array.isArray(mesh.material)?mesh.material[hit.face?.materialIndex||0]:mesh.material
        if(!visible || material?.transparent&&material.opacity<.95)continue
        if(isModel)score++
        break
      }
    }
    if(score>bestScore){bestScore=score;bestYaw=yaw}
  }
  scene.frameFromYaw(model,bestYaw,options)
  scene._homeGroup.userData.updateWalls(scene.camera)
}

function fitSilhouette(scene: InstanceType<typeof SceneManager>) {
  const width=480,height=360,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const context=canvas.getContext('2d',{willReadFrequently:true})!
  const material=new MeshBasicMaterial({color:0x000000}),background=scene.scene.background,override=scene.scene.overrideMaterial
  const visibility=scene.scene.children.map(object=>[object,object.visible] as const)
  try {
    scene.scene.background=new Color(0xffffff);scene.scene.overrideMaterial=material
    for(const [object] of visibility)object.visible=object===scene.buildGroup
    // 按实际投影轮廓收边，避免空心框架的包围盒留下过大空白。
    for(let pass=0;pass<2;pass++){
      scene._renderMainScene();context.drawImage(scene.renderer!.domElement,0,0,width,height)
      const pixels=context.getImageData(0,0,width,height).data
      let left=width,right=-1,top=height,bottom=-1
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i]+pixels[i+1]+pixels[i+2]<600){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}
      if(right<left)return
      const camera=scene.camera,target=scene.controls.target,distance=camera.position.distanceTo(target)
      const visibleHeight=2*distance*Math.tan(camera.fov*Math.PI/360)/camera.zoom
      const shift=new Vector3(1,0,0).applyQuaternion(camera.quaternion).multiplyScalar(((left+right+1)/2-width/2)/height*visibleHeight)
        .add(new Vector3(0,1,0).applyQuaternion(camera.quaternion).multiplyScalar((height/2-(top+bottom+1)/2)/height*visibleHeight))
      camera.position.add(shift);target.add(shift);camera.lookAt(target)
      camera.zoom*=Math.min((width-56)/(right-left+1),(height-48)/(bottom-top+1))
      camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
    }
  } finally {
    for(const [object,visible] of visibility)object.visible=visible
    scene.scene.background=background;scene.scene.overrideMaterial=override;material.dispose()
    scene._homeGroup?.userData.updateWalls(scene.camera)
    scene._updateTreeCamera()
  }
}

/** 独立模型与场景生成保存快照封面；标签切换与实时编辑不会改变这次截图。 */
export function renderModelCover(data: unknown): Promise<string | null> {
  const snapshot = structuredClone(data)
  const run = queue.then(async () => {
    await loadCatalog()
    const model = new BuildModel()
    const loaded = model.loadJSON(snapshot)
    if (!loaded.ok) throw new Error(`cover model load failed: ${loaded.reason}`)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:360px;pointer-events:none'
    host.setAttribute('aria-hidden', 'true')
    document.body.append(host)
    let scene: InstanceType<typeof SceneManager> | null = null
    try {
      scene = new SceneManager(host)
      scene.setMotion(false)
      scene.setTheme(false)
      scene.setHomeContext(model.homeContext)
      const background = model.previewBackground || (model.homeContext ? 'home' : 'grass')
      scene.setBackground(background === 'home' && !model.homeContext ? 'grass' : background)
      const tune = loadTune()
      applyFrameHex(tune.frame)
      scene.applyColorTune(tune)
      const current = scene
      scene.onMeshesReady = () => current.renderModel(model, null)
      scene.renderModel(model, null)
      if (!await waitSceneReady(scene)) throw new Error('cover meshes timed out')
      scene.renderModel(model, null)
      const bounds = scene.homeProductBounds()
      if (bounds) {frameCover(scene,model,bounds);fitSilhouette(scene)}
      else if (model.homeContext) scene.frameHome()
      const image = scene.snapshot({ hideGrid: true, hideLabels: true, hideRoom: false,
        width: 480, height: 360, pixelRatio: 2, mime: 'image/jpeg', quality: .88 })
      if (typeof image !== 'string') throw new Error('Cover image encoding failed')
      return image
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
