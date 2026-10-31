import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelMountQueue } from './panelMountQueue.js'
import { loadCatalog } from './catalog.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { withPlacementPass } from './incrementalPlacement.js'

// 此夹具只检查消息乱序、失效与资源释放；真实计算和鼠标安装另用Chrome Worker验收。
type MountRequest = { requestId: number; panelId: string; model: unknown }
type Mount = { a: string }
class MessageWorker extends EventTarget {
  static instances: MessageWorker[] = []
  messages: MountRequest[] = []
  terminated = false
  constructor() { super(); MessageWorker.instances.push(this) }
  postMessage(message: MountRequest) { this.messages.push(message) }
  terminate() { this.terminated = true }
  reply(mounts: Mount[], request = this.messages.at(-1)!) {
    this.dispatchEvent(new MessageEvent('message', { data: { type: 'result', requestId: request.requestId, mounts } }))
  }
}
const options = { screwAxis: 'auto', oppositeRetainers: true }
function setup() {
  vi.stubGlobal('Worker', MessageWorker)
  const ready = vi.fn(), error = vi.fn(), queue = new PanelMountQueue(ready, error)
  queues.push(queue)
  return { queue, ready, error }
}
const queues: PanelMountQueue[] = []
afterEach(() => { queues.splice(0).forEach(queue => queue.dispose()); MessageWorker.instances = []; vi.unstubAllGlobals() })

describe('板材后台挂位请求', () => {
  it('后台等待期间保留远处真实板位，附近旧位置消失，删除后由最新计算恢复', async () => {
    await loadCatalog()
    const {model}=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false})
    const other=createConfirmedComponentFixture('panel_40x40_honeycomb',{install:false}).model
    model.insertFragment(other.extractSelection(new Map([...other.nodes.keys()].map(id=>[id,'node']))),[1000,42.5,0])
    const {queue}=setup(),id='panel_40x40_honeycomb'
    const get=()=>withPlacementPass(model,()=>queue.get(model.toJSON(),id,options,model))
    expect(get()).toBeNull()
    const mounts=model.panelAccessoryMounts(id),worker=MessageWorker.instances[0]
    worker.reply(mounts);expect(get()).toEqual(mounts)
    const part=model.addConfirmedComponent(mounts[0],'blue')!
    expect(part).toBeTruthy()
    const partial=get()!
    expect(partial.length).toBeGreaterThan(0)
    expect(partial.length).toBeLessThan(mounts.length)
    const far=mounts.filter(p=>Math.hypot(...p.pos.map((v:number,i:number)=>v-mounts[0].pos[i]))>100)
    expect(far.length).toBeGreaterThan(0)
    for(const mount of far)expect(partial).toContainEqual(mount)
    expect(partial.every((p:unknown)=>model.panelPlacementDiagnostics(p).valid)).toBe(true)
    const after=model.panelAccessoryMounts(id);worker.reply(after);expect(get()).toEqual(after)
    model.removePanel(part.id);get()
    const restored=model.panelAccessoryMounts(id);worker.reply(restored)
    expect(get()).toEqual(mounts)
  })
  it('模型没变化时复用结果，空结果也不重复计算', () => {
    const { queue, ready } = setup(), data = { nodes: [{ x: 0 }] }
    expect(queue.get(data, 'panel_40x40', options)).toBeNull()
    const worker = MessageWorker.instances[0]
    worker.reply([])
    expect(ready).toHaveBeenCalledOnce()
    expect(queue.get(structuredClone(data), 'panel_40x40', options)).toEqual([])
    expect(worker.messages).toHaveLength(1)
  })

  it('同数量零件移动后旧结果不进入新模型，等待队列只计算最新选择', () => {
    const { queue, ready } = setup()
    queue.get({ nodes: [{ x: 0 }] }, 'panel_40x40', options)
    const worker = MessageWorker.instances[0]
    queue.get({ nodes: [{ x: 40 }] }, 'panel_40x20', options)
    queue.get({ nodes: [{ x: 80 }] }, 'acrylic_panel_40x40', options)
    worker.reply([{ a: 'old' }])
    expect(ready).not.toHaveBeenCalled()
    expect(worker.messages.map(m => m.panelId)).toEqual(['panel_40x40', 'acrylic_panel_40x40'])
    worker.reply([{ a: 'new' }])
    expect(ready).toHaveBeenCalledOnce()
    expect(queue.get({ nodes: [{ x: 80 }] }, 'acrylic_panel_40x40', options)).toEqual([{ a: 'new' }])
  })

  it('固定方向属于结果条件，返回已经缓存的选择时丢掉排队选择', () => {
    const { queue } = setup(), data = { nodes: [] }
    queue.get(data, 'panel_40x40', options)
    const worker = MessageWorker.instances[0]
    worker.reply([{ a: 'auto' }])
    queue.get(data, 'panel_40x40', { ...options, screwAxis: 'horizontal' })
    queue.get(data, 'panel_40x20', options)
    expect(queue.get(data, 'panel_40x40', options)).toEqual([{ a: 'auto' }])
    worker.reply([{ a: 'horizontal' }])
    expect(worker.messages).toHaveLength(2)
    expect(queue.get(data, 'panel_40x40', { ...options, screwAxis: 'horizontal' })).toEqual([{ a: 'horizontal' }])
  })

  it('排队的模型和选项不受之后的原地修改影响', () => {
    const { queue } = setup(), data = { panels: [{ params: { screwAxis: 'vertical' } }] }
    queue.get({ panels: [] }, 'panel_40x40', options)
    const worker = MessageWorker.instances[0], selected = { ...options }
    queue.get(data, 'panel_40x20', selected)
    data.panels[0].params.screwAxis = 'horizontal'
    selected.screwAxis = 'horizontal'
    worker.reply([])
    expect(worker.messages[1].model).toEqual({ panels: [{ params: { screwAxis: 'vertical' } }] })
    expect(worker.messages[1]).toMatchObject({ options: { screwAxis: 'auto' } })
  })

  it('退出模式不因迟到结果刷新，重入仍能复用', () => {
    const { queue, ready } = setup(), data = { nodes: [] }
    queue.get(data, 'panel_40x40', options)
    const worker = MessageWorker.instances[0]
    queue.cancel(); worker.reply([{ a: 'current' }])
    expect(ready).not.toHaveBeenCalled()
    expect(queue.get(data, 'panel_40x40', options)).toEqual([{ a: 'current' }])
  })

  it('失败保留错误并释放Worker，再次选择可重试；销毁后不处理消息', () => {
    const { queue, ready, error } = setup(), data = { nodes: [] }
    queue.get(data, 'panel_40x40', options)
    const worker = MessageWorker.instances[0], request = worker.messages[0]
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'error', requestId: request.requestId, error: 'load failed' } }))
    expect(error.mock.calls[0][0].message).toBe('load failed')
    expect(worker.terminated).toBe(true)
    queue.get(data, 'panel_40x40', options)
    expect(MessageWorker.instances).toHaveLength(1)
    queue.retry(); queue.get(data, 'panel_40x40', options)
    const next = MessageWorker.instances[1]
    queue.dispose(); next.reply([{ a: 'late' }])
    expect(next.terminated).toBe(true)
    expect(ready).not.toHaveBeenCalled()
  })
})
