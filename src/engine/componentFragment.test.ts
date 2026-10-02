import { describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'

describe('组件片段的配件引用', () => {
  it('重复放置后删除一份副本，不会删除原件或其他副本的轴承', () => {
    const model = new BuildModel()
    const node = model.addNode(0, 40, 0)
    const bearing = model.addBearingAtArm(node.id, [1, 0, 0])!
    const fragment = model.extractSelection(new Map([[node.id, 'node'], [bearing.id, 'fitting']]))
    const first = model.insertFragment(fragment, [200, 40, 0])
    const second = model.insertFragment(fragment, [400, 40, 0])
    expect(model.nodes.get(first.nodes[0])!.bearingOn).toBe(first.fittings[0])
    expect(model.nodes.get(second.nodes[0])!.bearingOn).toBe(second.fittings[0])
    model.removeNode(first.nodes[0])
    expect(model.fittings.has(bearing.id)).toBe(true)
    expect(model.fittings.has(first.fittings[0])).toBe(false)
    expect(model.fittings.has(second.fittings[0])).toBe(true)
  })
})
