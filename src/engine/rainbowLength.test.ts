import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { buildableTubes, geometry, loadCatalog, panels } from './catalog.js'
import { computeBOM } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

function rails(length: number, gap: number, offset = 0, reverse = false) {
  const model = new BuildModel()
  const tube = (start: number, end: number, y: number) => {
    const a = model.addNode(start, y, 0), b = model.addNode(end, y, 0)
    return model.addTube(a.id, b.id, 'T' + (Math.abs(end - start) - 5), 'blue', Math.abs(end - start) - 5)!
  }
  const a = tube(0, length, 0)
  const b = tube(reverse ? offset + length : offset, reverse ? offset : offset + length, gap)
  return { model, a, b }
}

// 隔离检查使用真实模型和 Yjs 历史；场景仅提供无绘制适配，不作为真实鼠标验收。
function controller(model: BuildModel, part = 'textile_rainbow') {
  const builder = Object.create(Builder.prototype) as Builder
  Object.assign(builder, {
    model, history: new ModelHistory(docFromJSON(model.toJSON() as any)),
    scene: {}, mode: 'fitting', fittingKind: 'textil2', fittingPart: part,
    color: 'green', selection: new Map(), refresh: () => {}, onNotice: () => {},
  })
  return builder
}

describe('彩虹门按实际尺寸安装', () => {
  it.each([[40, 40], [40, 60], [60, 40], [60, 60], [20, 60], [80, 57.5], [200, 40]])(
    '沿管 %s、管间距 %s：不按整格截断，不限制四格上限', (length, gap) => {
      const { model, a, b } = rails(length, gap), builder = controller(model)
      const [partner] = builder._freePartners(a.id, length / 2)
      expect(partner).toMatchObject({ id: b.id, len: length, gap, lo: 0, hi: length })
      expect(builder._countFittingPlaces()).toBe(1)
      expect(model.panelSection(partner, length - 1)).toEqual({ t0: 0, len: length, index: 0, count: 1 })
      builder._placeRailFitting(a.id, b.id, 0, partner.len)
      const [textile] = model.textiles.values()
      expect(textile.variant).toBe('rainbow')
      expect(model.textileSpan(textile)).toEqual({ len: length, gap })
      expect(computeBOM(model).textiles[0]).toMatchObject({ id: 'textile_rainbow', count: 1 })
    },
  )

  it.each([false, true])('错位管仅使用实际重叠部分，反向=%s', reverse => {
    const { model, a, b } = rails(80, 60, 20, reverse), builder = controller(model)
    const [partner] = builder._freePartners(a.id, 70)
    expect(partner).toMatchObject({ id: b.id, len: 60, lo: 20, hi: 80 })
    expect(model.panelSection(partner, 70)).toMatchObject({ t0: 20, len: 60, count: 1 })
  })

  it('仍要求平行且存在有效布面，拒绝交叉、无重叠及零尺寸', () => {
    const noOverlap = rails(40, 60, 40)
    expect(controller(noOverlap.model)._railPartners(noOverlap.a.id)).toEqual([])
    const noGap = rails(40, 0)
    expect(controller(noGap.model)._railPartners(noGap.a.id)).toEqual([])
    const crossed = rails(40, 60)
    crossed.model.nodes.get(crossed.b.b)!.y = 80
    expect(controller(crossed.model)._railPartners(crossed.a.id)).toEqual([])
  })

  it('普通布面、短布面、彩虹桥和网保留原尺寸规则', () => {
    const { model, a } = rails(60, 60)
    for (const part of ['textile', 'textile_20x40', 'textile_bridge']) {
      expect(controller(model, part)._railPartners(a.id)).toEqual([])
    }
    const net = controller(model)
    net.fittingKind = 'lattice2'
    expect(net._railPartners(a.id)).toEqual([])
    const standard = rails(60, 40)
    expect(controller(standard.model, 'textile')._railPartners(standard.a.id)[0].len).toBe(40)
  })

  it('1.5格彩虹门撤销重做、JSON重开和QDF往返保持实际尺寸与变体', () => {
    const { model, a, b } = rails(60, 60), builder = controller(model)
    const before = model.toJSON()
    builder._placeRailFitting(a.id, b.id, 0, 60)
    const saved = model.toJSON()
    builder.history.undo()
    expect(builder.history.toJSON()).toEqual(before)
    builder.history.redo()
    expect(builder.history.toJSON()).toEqual(saved)
    const reopened = new BuildModel()
    reopened.loadJSON(saved)
    expect(reopened.toJSON()).toEqual(saved)
    const imported = new BuildModel()
    imported.loadJSON(parseQDF(buildQDF(model).text, {
      tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2,
    }))
    const [textile] = imported.textiles.values()
    expect(textile.variant).toBe('rainbow')
    expect(imported.textileSpan(textile)).toEqual({ len: 60, gap: 60 })
  })
})
