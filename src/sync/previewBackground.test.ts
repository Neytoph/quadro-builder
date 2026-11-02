import {expect,it} from 'vitest'
import {BuildModel} from '../engine/model.js'
import {applyDelta,docFromJSON,docToJSON,writeJSON} from '../collab/ymodel'
import {productOnly} from '../share'

it.each(['grass','home','blank'])('保存和Yjs往返保留实际背景 %s',previewBackground=>{
  const model=new BuildModel(),data={format:2,nodes:[],previewBackground}
  expect(model.loadJSON(data).ok).toBe(true)
  expect(model.toJSON().previewBackground).toBe(previewBackground)
  const doc=docFromJSON(model.toJSON())
  expect(docToJSON(doc).previewBackground).toBe(previewBackground)
  const after={...model.toJSON(),previewBackground:'blank'}
  applyDelta(doc,model.toJSON(),after,null)
  expect(docToJSON(doc).previewBackground).toBe('blank')
  writeJSON(doc,{format:2,nodes:[]},null)
  expect(docToJSON(doc).previewBackground).toBeUndefined()
  doc.destroy()
})

it('不公开房间的副本清除房间背景选择，并保留原件',()=>{
  const data={nodes:[],previewBackground:'home',homeContext:{name:'私人房间'}}
  expect(productOnly(data)).toEqual({nodes:[],previewBackground:'grass'})
  expect(data.homeContext.name).toBe('私人房间')
})

it('无效背景被拒绝，旧模型没有被重写为任意背景',()=>{
  const model=new BuildModel()
  expect(model.loadJSON({format:2,nodes:[],previewBackground:'javascript:invalid'}).ok).toBe(false)
  expect(model.loadJSON({format:2,nodes:[]}).ok).toBe(true)
  expect(model.toJSON().previewBackground).toBeUndefined()
})
