import {beforeAll,describe,expect,it,vi} from 'vitest'
import {BoxGeometry,Group,InstancedMesh,Matrix4,Mesh,MeshBasicMaterial,Vector3} from 'three'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {SceneManager} from './scene.js'
import {loadCatalog} from './catalog.js'
import {selectionBounds} from './selectionTransform.js'
import {SelectionTransformPreview} from './selectionTransformPreview.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON} from '../collab/ymodel'

beforeAll(async()=>{await loadCatalog()})

// 真实BuildModel、Three矩阵及Yjs历史；场景适配省略WebGL，实际拖动另在浏览器测量。
function fixture(){
  const model=new BuildModel(),a=model.addNode(0,60,0),b=model.addNode(40,60,0),c=model.addNode(0,60,20),d=model.addNode(40,60,20)
  const t1=model.addTube(a.id,b.id,'T35','blue',35)!,t2=model.addTube(c.id,d.id,'T35','green',35)!
  const panel=model.addPanel(t1.id,t2.id,0,40,'panel_40x20','blue',1)!
  const selection=new Map<string,string>([...model.nodes.keys()].map(id=>[id,'node']))
  const buildGroup=new Group(),labelGroup=new Group(),geo=new BoxGeometry(1,1,1),mat=new MeshBasicMaterial()
  const instances=new InstancedMesh(geo,mat,2)
  instances.userData.instances=[{kind:'tube',id:t1.id},{kind:'tube',id:'unselected-tube'}]
  instances.setMatrixAt(0,new Matrix4().makeTranslation(20,60,0));instances.setMatrixAt(1,new Matrix4().makeTranslation(100,80,100))
  const board=new Mesh(geo,mat);board.userData={kind:'panel',id:panel.id};board.position.set(20,60,10)
  const detail=new Mesh(geo,mat);detail.position.set(1,2,3);board.add(detail)
  const outline=new Mesh(geo,mat);outline.userData.partOutlineFor=panel.id;outline.position.copy(board.position)
  buildGroup.add(instances,board,outline)
  // JS引擎在运行时附加字段；any连接真实原型及隔离场景适配，不替代模型／矩阵／历史。
  const scene:any=Object.assign(Object.create(SceneManager.prototype),{buildGroup,labelGroup,_motion:false,setHoverPart:vi.fn(),_shadowsDirty:vi.fn(),requestRender:vi.fn(),renderModel:vi.fn()})
  const builder:any=Object.assign(Object.create(Builder.prototype),{scene,model,selection,mode:'select',readOnly:false,stepFrom:[],_rotationDirections:new Map(),onNotice:vi.fn(),onHistoryChange:()=>{},onPreview:vi.fn(),refresh:vi.fn(),_cancelSelectFlip:()=>{}})
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  const position=(index:number)=>{const m=new Matrix4();instances.getMatrixAt(index,m);return new Vector3().setFromMatrixPosition(m).toArray()}
  return {model,selection,scene,builder,instances,board,detail,outline,position}
}

describe('三轴拖动的矩阵预览与最终校验',()=>{
  it('连续拖动不重载模型或重建场景，只移动目标实例、面板及其轮廓',()=>{
    const f=fixture(),before=f.model.toJSON(),json=f.builder.history.toJSON()
    const preview=new SelectionTransformPreview(f.scene,f.model,selectionBounds(f.model,f.selection)!)
    const load=vi.spyOn(f.model,'loadJSON')
    for(const y of [1,2,3,10.25])expect(preview.update({translation:[2,y,4]})).toBe(true)
    expect(f.position(0)).toEqual([22,70.25,4]);expect(f.position(1)).toEqual([100,80,100])
    expect(f.board.position.toArray()).toEqual([22,70.25,14]);expect(f.outline.position.toArray()).toEqual([22,70.25,14])
    expect(f.detail.getWorldPosition(new Vector3()).toArray()).toEqual([23,72.25,17])
    expect(preview.bounds.height).toBe(70.25);expect(f.scene.labelGroup.visible).toBe(false)
    expect(f.model.toJSON()).toEqual(before);expect(f.builder.history.toJSON()).toEqual(json)
    expect(load).not.toHaveBeenCalled();expect(f.scene.renderModel).not.toHaveBeenCalled()
    preview.dispose();expect(f.position(0)).toEqual([20,60,0]);expect(f.board.position.toArray()).toEqual([20,60,10])
    expect(f.instances.frustumCulled).toBe(true);expect(f.scene.labelGroup.visible).toBe(true)
  })

  it('旋转以原中心计算，不积累前一帧变换；取消恢复原矩阵',()=>{
    const f=fixture(),preview=new SelectionTransformPreview(f.scene,f.model,selectionBounds(f.model,f.selection)!)
    preview.update({axis:[0,1,0],angle:Math.PI/4});preview.update({axis:[0,1,0],angle:Math.PI/2})
    const p=f.position(0);expect(p[0]).toBeCloseTo(10);expect(p[1]).toBeCloseTo(60);expect(p[2]).toBeCloseTo(10)
    preview.dispose();expect(f.position(0)).toEqual([20,60,0])
  })

  it('跟随接头旋转的旧轴承预览与模型规则一致，未选中的轴承不随平移',()=>{
    const f=fixture(),node=[...f.model.nodes.values()][0]
    const bearing=f.model.addFitting('bearing2',0,60,0,{quat:[0,0,0,1]})
    node.bearingOn=bearing.id
    const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial())
    mesh.userData={kind:'fitting',id:bearing.id};mesh.position.set(0,60,0);f.scene.buildGroup.add(mesh)
    const preview=new SelectionTransformPreview(f.scene,f.model,selectionBounds(f.model,f.selection)!)
    preview.update({translation:[0,20,0]});expect(mesh.position.toArray()).toEqual([0,60,0])
    preview.update({translation:[0,20,0],axis:[0,1,0],angle:Math.PI/2})
    expect(mesh.position.x).toBeCloseTo(10);expect(mesh.position.y).toBeCloseTo(60);expect(mesh.position.z).toBeCloseTo(30)
    preview.dispose();expect(mesh.position.toArray()).toEqual([0,60,0])
  })

  it('拖动期间刷新不重建，松手才完整校验一次并产生一次可撤销历史',()=>{
    const f=fixture(),before=f.model.toJSON()
    expect(f.builder.beginSelectionTransform({visualPreview:true})).toBe(true)
    const validate=vi.spyOn(f.builder._selectionTransform,'preview')
    for(let i=1;i<=30;i++)f.builder.previewSelectionTransform({translation:[0,i,0]})
    Builder.prototype.refresh.call(f.builder)
    expect(f.scene.renderModel).not.toHaveBeenCalled();expect(validate).not.toHaveBeenCalled()
    expect(f.builder.selectionTransformState().position[1]).toBe(90)
    expect(f.builder.finishSelectionTransform()).toBe(true);expect(validate).toHaveBeenCalledTimes(1)
    expect([...f.model.nodes.values()].every(n=>n.y===90)).toBe(true)
    f.builder.history.undo();expect(f.builder.history.toJSON()).toEqual(before);expect(f.builder.history.canUndo()).toBe(false)
  })

  it('向下平移在地面停住，超量拖动不积累，向上拖动可继续且只提交一次',()=>{
    const f=fixture(),before=f.model.toJSON()
    expect(f.builder.beginSelectionTransform({visualPreview:true})).toBe(true)
    for(const dy of [-60,-80,-1000]){
      expect(f.builder.previewSelectionTransform({translation:[3,dy,4]})).toBe(true)
      expect(f.builder.selectionTransformState().position[1]).toBe(0)
      expect(f.position(0)).toEqual([23,0,4])
      expect(f.builder._selectionTransform.visualPreview.value.translation).toEqual([3,-60,4])
      expect(f.builder.transformError).toBeNull()
    }
    expect(f.model.toJSON()).toEqual(before);expect(f.builder.history.canUndo()).toBe(false)
    expect(f.builder.previewSelectionTransform({translation:[3,-55,4]})).toBe(true)
    expect(f.builder.selectionTransformState().position[1]).toBe(5)
    f.builder.previewSelectionTransform({translation:[3,-100,4]})
    expect(f.builder.finishSelectionTransform()).toBe(true)
    expect([...f.model.nodes.values()].every(n=>n.y===0)).toBe(true)
    f.builder.history.undo();expect(f.builder.history.toJSON()).toEqual(before);expect(f.builder.history.canUndo()).toBe(false)
  })

  it.each(['invalid','readonly','external','cancel'])('%s取消或拒绝后不写历史，画面恢复',reason=>{
    const f=fixture(),before=f.model.toJSON();f.builder.beginSelectionTransform({visualPreview:true})
    f.builder.previewSelectionTransform({translation:[0,20,0]})
    if(reason==='invalid')f.builder.previewSelectionTransform({translation:[0,NaN,0]})
    if(reason==='readonly')f.builder.readOnly=true
    if(reason==='external')f.builder._externalPending=true
    if(reason==='cancel')f.builder.cancelSelectionTransform()
    else expect(f.builder.finishSelectionTransform()).toBe(false)
    expect(f.model.toJSON()).toEqual(before);expect(f.builder.history.canUndo()).toBe(false)
    expect(f.position(0)).toEqual([20,60,0]);expect(f.scene.selectionTransformPreview).toBeNull()
  })

  it('松手仍拒绝新碰撞，局部选区在开始拖动前被阻止',()=>{
    const f=fixture(),a=f.model.addNode(0,80,0),b=f.model.addNode(40,80,0)
    f.model.addTube(a.id,b.id,'T35','red',35)
    f.builder.setHistory(new ModelHistory(docFromJSON(f.model.toJSON())))
    const before=f.model.toJSON()
    expect(f.builder.beginSelectionTransform({visualPreview:true})).toBe(true)
    f.builder.previewSelectionTransform({translation:[0,20,0]})
    expect(f.builder.finishSelectionTransform()).toBe(false)
    expect(f.model.toJSON()).toEqual(before);expect(f.builder.history.canUndo()).toBe(false)
    const node=[...f.model.nodes.keys()][0]
    f.builder.selection=new Map([[node,'node']])
    expect(f.builder.beginSelectionTransform({visualPreview:true})).toBe(false)
    expect(f.scene.selectionTransformPreview).toBeNull()
  })

  it('截图使用已确认姿态，截图后继续显示当前预览姿态',()=>{
    const f=fixture(),preview=new SelectionTransformPreview(f.scene,f.model,selectionBounds(f.model,f.selection)!)
    preview.update({translation:[0,20,0]})
    f.scene.renderer={getPixelRatio:()=>1,domElement:{toDataURL:()=> 'data:image/png;base64,'}}
    f.scene._renderMainScene=()=>expect(f.position(0)).toEqual([20,60,0])
    f.scene.snapshot();expect(f.position(0)).toEqual([20,80,0]);preview.dispose()
  })

  it('取消及拒绝旋转恢复此前读数，数值旋转成功后保留实际读数',()=>{
    const f=fixture()
    f.builder.setSelectionRotationReadout('X',12.34,false)
    f.builder.beginSelectionTransform({visualPreview:true});f.builder.setSelectionRotationReadout('Z',-20,false)
    f.builder.cancelSelectionTransform()
    expect(f.builder.selectionTransformState().rotation).toMatchObject({axis:'X',degrees:12.34})
    f.builder.beginSelectionTransform({visualPreview:true});f.builder.setSelectionRotationReadout('Y',-30,false)
    f.builder.previewSelectionTransform({axis:[1,0,0],angle:Math.PI/2,translation:[0,-100,0]})
    expect(f.builder.finishSelectionTransform()).toBe(false)
    expect(f.builder.selectionTransformState().rotation).toMatchObject({axis:'X',degrees:12.34})
    expect(f.builder.rotateSelectionAxis('Z',5)).toBe(true)
    expect(f.builder.selectionTransformState().rotation).toMatchObject({axis:'Z',degrees:5})
  })
})
