import {beforeAll,describe,expect,it,vi} from 'vitest'
import {Scene,Object3D,PerspectiveCamera,OrthographicCamera,Mesh,ShaderMaterial,Vector3} from 'three'
import {BuildModel} from './model.js'
import {loadCatalog} from './catalog.js'
import {SelectionTransformGizmo} from './selectionTransformGizmo.js'
import {SceneManager} from './scene.js'

beforeAll(async()=>{await loadCatalog()})

describe('真实Three操作轴生命周期',()=>{
  function fixture(){
    const model=new BuildModel(),a=model.addNode(0,30,0),b=model.addNode(40,30,0)
    model.addTube(a.id,b.id,'T35','blue',35)
    const canvas=document.createElement('canvas')
    const scene={scene:new Scene(),renderer:{domElement:canvas},camera:new PerspectiveCamera() as PerspectiveCamera|OrthographicCamera,controls:{enabled:true},requestRender:vi.fn(),setCursor:vi.fn()}
    const builder={model,scene,selection:new Map([[a.id,'node'],[b.id,'node']]),mode:'select',readOnly:false,transformMode:'translate',transformSnap:false,cancelSelectionTransform:vi.fn(),setSelectionRotationReadout:vi.fn()}
    return {builder,scene,canvas,gizmo:new SelectionTransformGizmo(builder)}
  }

  it('跟随选区中心与相机，空选区和只读时隐藏',()=>{
    const {builder,scene,gizmo}=fixture()
    gizmo.sync();expect(gizmo.proxy.position.toArray()).toEqual([20,30,0]);expect(gizmo.helper.visible).toBe(true)
    scene.camera=new OrthographicCamera();gizmo.updateCamera();expect(gizmo.control.camera).toBe(scene.camera)
    builder.readOnly=true;gizmo.sync();expect(gizmo.helper.visible).toBe(false);expect(gizmo.control.enabled).toBe(false)
    builder.readOnly=false;builder.selection.delete([...builder.selection.keys()][0]);gizmo.sync()
    expect(gizmo.helper.visible).toBe(false);expect(gizmo.control.enabled).toBe(false)
    builder.selection.clear();gizmo.sync();expect(gizmo.helper.visible).toBe(false)
    gizmo.dispose()
  })

  it('三轴均保留完整正向箭头与对应拾取范围，圆环和箭杆采用圆滑截面',()=>{
    const {gizmo}=fixture()
    const root=gizmo.helper.children.find(child=>child.type==='TransformControlsGizmo') as Object3D & {gizmo:Record<string,Object3D>;picker:Record<string,Object3D>}
    for(const axis of ['X','Y','Z']){
      const handles=root.gizmo.translate.children.filter(child=>child.name===axis) as Mesh[]
      expect(handles).toHaveLength(2)
      for(const handle of handles){
        handle.geometry.computeBoundingBox()
        expect(handle.geometry.boundingBox!.min.getComponent('XYZ'.indexOf(axis))).toBeGreaterThanOrEqual(-0.000001)
        expect(handle.geometry.getAttribute('position').count).toBeGreaterThan(50)
      }
      expect(root.picker.translate.children.filter(child=>child.name===axis)).toHaveLength(1)
      const ring=root.gizmo.rotate.children.find(child=>child.name===axis) as Mesh
      expect(ring.geometry.getAttribute('position').count).toBeGreaterThan(500)
    }
    gizmo.dispose()
  })

  it('更换画布时移除旧监听，销毁时释放操作轴所有几何和材质',()=>{
    const {scene,canvas,gizmo}=fixture(),remove=vi.spyOn(canvas,'removeEventListener')
    scene.renderer.domElement=document.createElement('canvas');gizmo.bindCanvas()
    expect(remove.mock.calls.filter(args=>args[2]===true)).toHaveLength(5)
    const geometries=new Set(),materials=new Set(),disposedGeometries=new Set(),disposedMaterials=new Set()
    // 直接读取真实Three对象和dispose事件；不把资源检查记作浏览器操作验收。
    gizmo.helper.traverse((object:Object3D)=>{
      const mesh=object as Object3D & {geometry?:{addEventListener:(type:string,fn:()=>void)=>void};material?:{addEventListener:(type:string,fn:()=>void)=>void}}
      if(mesh.geometry && !geometries.has(mesh.geometry)){geometries.add(mesh.geometry);mesh.geometry.addEventListener('dispose',()=>disposedGeometries.add(mesh.geometry))}
      if(mesh.material && !materials.has(mesh.material)){materials.add(mesh.material);mesh.material.addEventListener('dispose',()=>disposedMaterials.add(mesh.material))}
    })
    gizmo.dispose()
    expect(scene.scene.children).toHaveLength(0)
    expect(disposedGeometries.size).toBe(geometries.size);expect(disposedMaterials.size).toBe(materials.size)
  })

  it('平面手柄使用带双色轮廓的圆角L形，与加宽的拾取路径一致',()=>{
    const {gizmo}=fixture()
    const root=gizmo.helper.children.find(child=>child.type==='TransformControlsGizmo') as Object3D & {gizmo:Record<string,Object3D>;picker:Record<string,Object3D>}
    gizmo.sync()
    for(const axis of ['XY','YZ','XZ'] as const){
      const handle=root.gizmo.translate.children.find(child=>child.name===axis) as Mesh
      const material=handle.material as import('three').MeshBasicMaterial
      const picker=root.picker.translate.children.find(child=>child.name===axis) as Mesh
      const geometry=handle.geometry as import('three').TubeGeometry,pickGeometry=picker.geometry as import('three').TubeGeometry
      expect(geometry.type).toBe('TubeGeometry');expect(pickGeometry.type).toBe('TubeGeometry')
      expect(pickGeometry.parameters.radius).toBeGreaterThan(geometry.parameters.radius)
      expect(pickGeometry.parameters.path.getPoint(0.5).toArray()).toEqual(geometry.parameters.path.getPoint(0.5).toArray())
      expect(material.opacity).toBe(1)
      expect(handle.children.filter(child=>child.userData.selectionTransformContour)).toHaveLength(2)
      gizmo.control.axis=axis;gizmo.helper.updateMatrixWorld(true)
      expect(material.color.getHexString()).toBe('ffd05a')
      gizmo.control.axis=null;gizmo.helper.updateMatrixWorld(true)
      expect(material.opacity).toBe(1);expect(material.color.getHexString()).not.toBe('ffd05a')
    }
    gizmo.dispose()
  })

  it('描边仅修饰可见轴，不进入拾取网格；按视口更新且悬停时加粗',()=>{
    const {gizmo}=fixture()
    const root=gizmo.helper.children.find(child=>child.type==='TransformControlsGizmo')!
    // 读取真实Three层级；只用渲染器尺寸适配检查uniform更新，画面另由实际浏览器验收。
    const native=root as Object3D & {gizmo:Record<string,Object3D>;picker:Record<string,Object3D>}
    const contours:Mesh[]=[]
    native.gizmo.translate.traverse(object=>{if(object.userData.selectionTransformContour)contours.push(object as Mesh)})
    expect(contours.length).toBeGreaterThan(0)
    for(const picker of Object.values(native.picker))picker.traverse(object=>expect(object.userData.selectionTransformContour).toBeUndefined())
    const contour=contours[0],material=contour.material as ShaderMaterial
    const update=contour.onBeforeRender as unknown as (renderer:{getSize:(size:{set:(x:number,y:number)=>void})=>void})=>void
    update({getSize:size=>size.set(390,844)})
    expect(material.uniforms.viewport.value.toArray()).toEqual([390,844])
    const width=material.uniforms.width.value
    gizmo.control.axis=contour.parent!.name as 'X'|'Y'|'Z'
    update({getSize:size=>size.set(1204,788)})
    expect(material.uniforms.viewport.value.toArray()).toEqual([1204,788])
    expect(material.uniforms.width.value).toBeGreaterThan(width)
    expect(material.depthTest).toBe(false);expect(material.depthWrite).toBe(false)
    gizmo.dispose()
  })

  it('导出图像时隐藏操作轴，完成后恢复可见性',()=>{
    const {scene,gizmo}=fixture();gizmo.sync()
    // 运行真实snapshot的隐藏／恢复流程；渲染器适配只记录可见性，不冒充WebGL图像验收。
    const host=Object.assign(Object.create(SceneManager.prototype),{
      scene:scene.scene,camera:scene.camera,selectionTransformGizmo:gizmo,_finishMotion:()=>{},
      renderer:{getPixelRatio:()=>1,domElement:{toDataURL:()=> 'data:image/png;base64,'},render:()=>expect(gizmo.helper.visible).toBe(false)},
    })
    host.snapshot();expect(gizmo.helper.visible).toBe(true);gizmo.dispose()
  })

  it('同一帧多次指针更新合并为一次预览，松手应用最后位置，取消不回放待处理更新',()=>{
    const {builder,canvas,gizmo}=fixture(),preview=vi.fn(),finish=vi.fn()
    Object.assign(builder,{_selectionTransform:{bounds:{center:[20,30,0]}},previewSelectionTransform:preview,finishSelectionTransform:finish})
    // 适配隔离DOM缺少的指针捕获查询；真实捕获与拖动在IAB中验收。
    canvas.hasPointerCapture=()=>false
    gizmo.pointerId=7
    for(let y=31;y<=60;y++){gizmo.proxy.position.set(20,y,0);gizmo.preview()}
    expect(preview).not.toHaveBeenCalled()
    gizmo.flushPreview();expect(preview).toHaveBeenCalledTimes(1)
    expect(preview.mock.calls[0][0].translation).toEqual([0,30,0])
    gizmo.proxy.position.y=61;gizmo.preview()
    gizmo.up({pointerId:7,preventDefault:()=>{},stopImmediatePropagation:()=>{}})
    expect(preview).toHaveBeenCalledTimes(2);expect(preview.mock.calls[1][0].translation).toEqual([0,31,0]);expect(finish).toHaveBeenCalledOnce()
    gizmo.pointerId=8;gizmo.preview();gizmo.cancel();gizmo.flushPreview()
    expect(preview).toHaveBeenCalledTimes(2);gizmo.dispose()
  })

  it.each(['X','Y','Z'] as const)('%s圆环同步实际带符号角度，而非默认值或Euler角',axis=>{
    const {builder,gizmo}=fixture()
    // 当前Three运行时提供这些状态，配套声明尚未包含；直接检查真实实例。
    const control=gizmo.control as typeof gizmo.control & {rotationAxis:Vector3;rotationAngle:number}
    Object.assign(builder,{_selectionTransform:{bounds:{center:[20,30,0]}},previewSelectionTransform:vi.fn()})
    gizmo.pointerId=7;gizmo.control.setMode('rotate');gizmo.control.axis=axis
    const vector=[0,0,0];vector['XYZ'.indexOf(axis)]=1
    control.rotationAxis.fromArray(vector)
    control.rotationAngle=-Math.PI/4
    gizmo.preview();gizmo.flushPreview()
    expect(builder.setSelectionRotationReadout).toHaveBeenLastCalledWith(axis,-45,false)
    // 正对轴的另一端时，Three以视线方向计角，读数统一为世界轴方向。
    control.rotationAxis.negate();control.rotationAngle=Math.PI/6
    gizmo.preview();gizmo.flushPreview()
    expect(builder.setSelectionRotationReadout.mock.calls.at(-1)![0]).toBe(axis)
    expect(builder.setSelectionRotationReadout.mock.calls.at(-1)![1]).toBeCloseTo(-30)
    gizmo.pointerId=null;gizmo.dispose()
  })

  it('自由旋转不误标为某根世界轴，并保留超过一圈的真实角度',()=>{
    const {builder,gizmo}=fixture()
    const control=gizmo.control as typeof gizmo.control & {rotationAngle:number}
    Object.assign(builder,{_selectionTransform:{bounds:{center:[20,30,0]}},previewSelectionTransform:vi.fn()})
    gizmo.pointerId=7;gizmo.control.setMode('rotate');gizmo.control.axis='E';control.rotationAngle=4*Math.PI
    gizmo.preview();gizmo.flushPreview()
    expect(builder.setSelectionRotationReadout).toHaveBeenLastCalledWith('free',720,false)
    gizmo.pointerId=null;gizmo.dispose()
  })
})
