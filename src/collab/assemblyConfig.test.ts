import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BuildModel } from '../engine/model.js'
import { FORMAT_VERSION } from '../engine/config.js'
import { validAssemblyConfig } from '../engine/assemblyConfig.js'
import { docFromJSON, docToJSON, writeJSON, type ModelJSON } from './ymodel'
import { ModelHistory } from './history'

// 隔离夹具验证元数据协议，不代表真实模型装配验收。
const config = { version: 1, regions: [{ id: 'base', name: '底座', partIds: ['n1'] }], order: ['base'] }
const data: ModelJSON = { format: FORMAT_VERSION, nodes: [{ id: 'n1', x: 0, y: 0, z: 0 }] }

describe('装配区域原生 JSON 和协作', () => {
  it('旧模型无配置字段；配置可重开，格式版本保持', () => {
    const m = new BuildModel()
    expect(m.loadJSON(data).ok).toBe(true)
    expect(m.toJSON()).not.toHaveProperty('assemblyConfig')
    expect(m.loadJSON({ ...data, assemblyConfig: config }).ok).toBe(true)
    const json = m.toJSON()
    expect(json.format).toBe(FORMAT_VERSION)
    expect(json.assemblyConfig).toEqual(config)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(json).ok).toBe(true)
    expect(reopened.toJSON().assemblyConfig).toEqual(config)
    json.assemblyConfig.regions[0].name = 'outside'
    expect(m.toJSON().assemblyConfig.regions[0].name).toBe('底座')
    expect(m.loadJSON(data).ok).toBe(true)
    expect(m.toJSON()).not.toHaveProperty('assemblyConfig')
  })

  it('无效结构拒绝载入，旧模型保持；失效零件引用保留供计划诊断', () => {
    const m = new BuildModel()
    expect(m.loadJSON(data).ok).toBe(true)
    const before = m.toJSON()
    const invalid = { ...config, order: ['unknown'] }
    expect(validAssemblyConfig(invalid)).toBe(false)
    expect(m.loadJSON({ ...data, assemblyConfig: invalid }).ok).toBe(false)
    expect(m.toJSON()).toEqual(before)
    expect(m.loadJSON({ ...data, assemblyConfig: { ...config, regions: [{ id: 'base', name: '旧区域', partIds: ['deleted'] }] } }).ok).toBe(true)
  })

  it('配置写入 Yjs、同步到远端、撤销与重做', () => {
    const a = docFromJSON(data), b = new Y.Doc()
    a.on('update', update => Y.applyUpdate(b, update, 'remote'))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote')
    const history = new ModelHistory(a)
    history.commit(JSON.stringify(data), JSON.stringify({ ...data, assemblyConfig: config }))
    expect(docToJSON(a).assemblyConfig).toEqual(config)
    expect(docToJSON(b).assemblyConfig).toEqual(config)
    history.undo()
    expect(docToJSON(a)).not.toHaveProperty('assemblyConfig')
    expect(docToJSON(b)).not.toHaveProperty('assemblyConfig')
    history.redo()
    expect(docToJSON(a).assemblyConfig).toEqual(config)
    expect(docToJSON(b).assemblyConfig).toEqual(config)
    history.destroy(); a.destroy(); b.destroy()
  })

  it('本地零件编辑保留远端新区域配置；撤销配置保留远端零件改动', () => {
    const doc = docFromJSON({ ...data, assemblyConfig: config })
    const history = new ModelHistory(doc)
    const before = docToJSON(doc)
    const next = { ...config, regions: [{ ...config.regions[0], name: '平台' }] }
    history.commit(JSON.stringify(before), JSON.stringify({ ...before, assemblyConfig: next }))
    const remote = { ...docToJSON(doc), nodes: [{ id: 'n1', x: 40, y: 0, z: 0 }] }
    writeJSON(doc, remote, 'remote')
    history.undo()
    expect(docToJSON(doc).nodes[0].x).toBe(40)
    expect(docToJSON(doc).assemblyConfig).toEqual(config)
    const stale = { ...docToJSON(doc), assemblyConfig: config }
    writeJSON(doc, { ...stale, assemblyConfig: next }, 'remote')
    history.commit(JSON.stringify(stale), JSON.stringify({ ...stale, nodes: [{ id: 'n1', x: 80, y: 0, z: 0 }] }))
    expect(docToJSON(doc).assemblyConfig).toEqual(next)
    history.destroy(); doc.destroy()
  })
})
