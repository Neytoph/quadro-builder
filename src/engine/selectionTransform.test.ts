import {beforeAll,describe,expect,it,vi} from 'vitest'
import {BuildModel} from './model.js'
import {Builder} from './builder.js'
import {loadCatalog,buildableTubes,panels,geometry} from './catalog.js'
import {buildQDF} from './qdfexport.js'
import {parseQDF} from './qdfimport.js'
import {SelectionTransformSession} from './selectionTransformSession.js'
import {selectionBounds,incompleteRigidSelection,connectedTransformSelection} from './selectionTransform.js'
import {ModelHistory} from '../collab/history'
import {docFromJSON,partsMap} from '../collab/ymodel'
import {neededParts,computeBOM,infeasibleConnectors} from './bom.js'

beforeAll(async()=>{await loadCatalog()})

// 隔离管架使用真实模型、面板安装和Yjs历史；仅省略WebGL及浏览器事件。
function deck(y=30) {
  const model=new BuildModel(),rows=[0,40,80].map(z=>[model.addNode(0,y,z),model.addNode(20,y,z)])
  for(const row of rows)model.addTube(row[0].id,row[1].id,'T15','yellow',15)
  for(let i=0;i<2;i++){
    const a=model.addTube(rows[i][0].id,rows[i+1][0].id,'T35','blue',35)!
    const b=model.addTube(rows[i][1].id,rows[i+1][1].id,'T35','green',35)!
    expect(model.addPanel(a.id,b.id,0,40,'panel_40x20','blue',1)).toBeTruthy()
  }
  const selection=new Map<string,string>([...model.nodes.keys()].map(id=>[id,'node']))
  // JS控制器附加运行时字段，用any接真实原型；没有替代模型或历史实现。
  const builder:any=Object.create(Builder.prototype)
  Object.assign(builder,{model,selection,mode:'select',readOnly:false,stepFrom:[],_rotationDirections:new Map(),onNotice:vi.fn(),onHistoryChange:()=>{},refresh:vi.fn(),_cancelSelectFlip:()=>{}})
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return {model,builder,selection,rows}
}

describe('选区三轴移动、旋转及准确高度',()=>{
  it('单选只支持组件自身操作，移动入口和直接调用均不提交；多选恢复变换',()=>{
    const {model,builder}=deck(60),tube=[...model.tubes.values()][0],before=model.toJSON()
    builder.selection=new Map([[tube.id,'tube']])
    expect(builder.selectionTransformState()).toBeNull()
    expect(builder.beginSelectionTransform()).toBe(false)
    expect(builder.setSelectionPosition([0,100,0])).toBe(false)
    expect(builder.rotateSelectionAxis('X',15)).toBe(false)
    expect(builder.moveSelectionBy([0,1,0],10)).toBe(false)
    expect(builder.rotateSelectionBy()).toBe(false)
    expect(model.toJSON()).toEqual(before);expect(builder.history.canUndo()).toBe(false)
    const panel=[...model.panels.values()][0],side=panel.side
    builder.selection=new Map([[panel.id,'panel']])
    expect(builder.adjustSelectedPart()).toBe(true)
    expect(model.panels.get(panel.id)!.side).not.toBe(side)
    builder.selection=connectedTransformSelection(model,builder.selection)
    expect(builder.selectionTransformState()).not.toBeNull()
    const after=model.toJSON();builder.readOnly=true
    expect(builder.adjustSelectedPart()).toBe(false);expect(model.toJSON()).toEqual(after)
  })
  it('桥面从地面升到30.25cm，保存、料表、支撑引用及撤销重做保持',()=>{
    const {model,builder}=deck(0),before=model.toJSON(),bom=neededParts(computeBOM(model))
    expect(builder.setSelectionPosition([10,30.25,40])).toBe(true)
    expect([...model.nodes.values()].every(n=>n.y===30.25)).toBe(true)
    expect(neededParts(computeBOM(model))).toEqual(bom)
    expect(model.panels.size).toBe(2)
    const after=model.toJSON(),reopened=new BuildModel()
    expect(reopened.loadJSON(after).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(after)
    builder.history.undo();expect(builder.history.toJSON()).toEqual(before)
    builder.history.redo();expect(builder.history.toJSON()).toEqual(after)
    builder.history.undo();expect(builder.history.canUndo()).toBe(false)
  })

  it('连续预览不修改已确认模型及文档，提交只产生一次历史',()=>{
    const {model,builder}=deck(),before=model.toJSON()
    expect(builder.beginSelectionTransform()).toBe(true)
    for(const y of [0.13,1.79,10.25])expect(builder.previewSelectionTransform({translation:[2.37,y,4.91]})).toBe(true)
    expect(model.toJSON()).toEqual(before);expect(builder.history.toJSON()).toEqual(before)
    expect(builder.finishSelectionTransform()).toBe(true)
    expect(selectionBounds(model,builder.selection)!.height).toBe(40.25)
    builder.history.undo();expect(builder.history.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it.each(['X','Y','Z'] as const)('%s轴旋转保持管长、板、接头、料表及JSON重开',axis=>{
    const {model,builder}=deck(100),before=model.toJSON(),bom=neededParts(computeBOM(model))
    const lengths=[...model.tubes.values()].map(t=>{const a=model.nodes.get(t.a)!,b=model.nodes.get(t.b)!;return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)})
    expect(builder.rotateSelectionAxis(axis,90)).toBe(true)
    expect(neededParts(computeBOM(model))).toEqual(bom)
    expect(model.panels.size).toBe(2)
    expect(infeasibleConnectors(model).size).toBe(0)
    const after=model.toJSON(),reopen=new BuildModel()
    expect(reopen.loadJSON(after).ok).toBe(true);expect(reopen.toJSON()).toEqual(after)
    ;[...model.tubes.values()].forEach((t,i)=>{const a=model.nodes.get(t.a)!,b=model.nodes.get(t.b)!;expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeCloseTo(lengths[i],2)})
    builder.history.undo();expect(builder.history.toJSON()).toEqual(before)
  })

  it('任意角度与反向旋转恢复桥面，面板姿态随结构转动',()=>{
    const {model,builder}=deck(100),before=model.toJSON()
    const panel=[...model.panels.values()][0],corners=model.panelCorners(panel)
    expect(builder.rotateSelectionAxis('X',17.3)).toBe(true)
    expect(model.panelCorners(model.panels.get(panel.id)!)).not.toEqual(corners)
    expect(builder.rotateSelectionAxis('X',-17.3)).toBe(true)
    for(const node of before.nodes){const actual=model.nodes.get(node.id)!;expect(actual.x).toBeCloseTo(node.x,1);expect(actual.y).toBeCloseTo(node.y,1);expect(actual.z).toBeCloseTo(node.z,1)}
  })

  it('单块面板或单根管的局部选区不会拆掉另一块桥面',()=>{
    const {model,builder}=deck(),before=model.toJSON(),part=[...model.panels.values()][0]
    builder.selection=new Map([[part.id,'panel']])
    expect(incompleteRigidSelection(model,model.moveTargets(builder.selection))).toBe(true)
    expect(builder.setSelectionPosition([10,60,20])).toBe(false)
    expect(model.toJSON()).toEqual(before);expect(builder.history.canUndo()).toBe(false)
  })

  it('数值高度在地面卡住，旋转越界仍拒绝，原模型与文档保持',()=>{
    const {model,builder}=deck(0),before=model.toJSON()
    expect(builder.setSelectionPosition([10,-20,40])).toBe(true)
    expect(model.toJSON()).toEqual(before)
    expect(builder.rotateSelectionAxis('X',90)).toBe(false)
    expect(model.toJSON()).toEqual(before)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('与另一个管架的新碰撞被拒绝',()=>{
    const {model,builder}=deck(30)
    const a=model.addNode(0,60,0),b=model.addNode(20,60,0)
    model.addTube(a.id,b.id,'T15','red',15)
    builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
    const before=model.toJSON()
    expect(builder.setSelectionPosition([10,60,40])).toBe(false)
    expect(model.toJSON()).toEqual(before)
  })

  it('Esc取消、只读、非数值与空选区不会提交',()=>{
    const {model,builder}=deck(),before=model.toJSON()
    builder.beginSelectionTransform();builder.previewSelectionTransform({translation:[0,12,0]});builder.cancelSelectionTransform()
    expect(model.toJSON()).toEqual(before)
    builder.readOnly=true;expect(builder.setSelectionPosition([10,60,40])).toBe(false)
    builder.readOnly=false;expect(builder.setSelectionPosition([10,NaN,40])).toBe(false)
    builder.selection.clear();expect(builder.beginSelectionTransform()).toBe(false)
    expect(builder.history.canUndo()).toBe(false)
  })

  it('权限撤销及外部修改到来后，预览不能覆盖协作模型',()=>{
    const {model,builder}=deck(),before=model.toJSON()
    const session=new SelectionTransformSession(builder)
    session.preview({translation:[0,10,0]});builder.readOnly=true
    expect(session.commit()).toBe(false);expect(model.toJSON()).toEqual(before)
    builder.readOnly=false;builder._selectionTransform=session
    const record=partsMap(builder.history.doc).get(before.nodes[0].id)!
    builder.history.doc.transact(()=>record.set('color','red'),{remote:true})
    expect(builder._externalPending).toBe(true)
    expect(session.commit()).toBe(false)
    expect(record.get('color')).toBe('red')
  })

  it('三轴旋转后的QDF保持实际管端、板数量和尺寸',()=>{
    const {model,builder}=deck(100)
    expect(builder.rotateSelectionAxis('X',17.3)).toBe(true)
    expect(builder.rotateSelectionAxis('Z',11.2)).toBe(true)
    const exported=buildQDF(model),copy=new BuildModel()
    expect(copy.loadJSON(parseQDF(exported.text,{tubes:buildableTubes(),panels:panels(),connectorSize:geometry().connectorSize,mergeEps:2})).ok).toBe(true)
    expect(copy.panels.size).toBe(model.panels.size)
    expect(copy.tubes.size).toBe(model.tubes.size)
    for(const node of model.nodes.values())expect([...copy.nodes.values()].some(other=>Math.hypot(node.x-other.x,node.y-other.y,node.z-other.z)<0.03)).toBe(true)
    expect([...copy.panels.values()].map(p=>p.panelId).sort()).toEqual([...model.panels.values()].map(p=>p.panelId).sort())
  })

  it('选整块桥面不会把包围范围相近的独立泳池带走，高度取最低接头',()=>{
    const {model,selection}=deck(30),tube=[...model.tubes.values()][0]
    const pool=model.addFitting('pool-small2',70,20,0,{w:80,h:20,d:80,quat:[0,0,0,1]})
    const chosen=connectedTransformSelection(model,new Map([[tube.id,'tube']]))
    expect(chosen.has(pool.id)).toBe(false)
    expect(selectionBounds(model,chosen)!.height).toBe(30)
    selection.set(pool.id,'fitting')
    expect(selectionBounds(model,selection)!.height).toBe(30)
  })
})
