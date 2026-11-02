import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { Builder, confirmedFittingHandlePosition } from './builder.js'
import { curvePoint } from './confirmedComponentModel.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'

beforeAll(async () => { await loadCatalog() })

describe('弧面配件安装点', () => {
  it.each(['lattice_curved', 'textile_round', 'textile_round_fourway'])('%s 的安装点位于弧面，点击可安装', id => {
    const { model, candidate } = createConfirmedComponentFixture(id, { install: false })
    const a = curvePoint(model, candidate.a, 0.5)!, b = curvePoint(model, candidate.b, 0.5)!
    const expected = a.map((value: number, i: number) => (value + b[i]) / 2)
    const handles: any[] = []
    const builder = Object.create(Builder.prototype)
    Object.assign(builder, {
      model, fittingKind: id, fittingPart: id,
      scene: { addHandle: (position: number[], data: any) => handles.push({ position, data }) },
    })
    builder._buildFittingHandles()
    const handle = handles.find(h => h.data.confirmedComponent.a === candidate.a && h.data.confirmedComponent.b === candidate.b)
    expect(handle.position).toEqual(expected)
    expect(confirmedFittingHandlePosition(model, candidate)).toEqual(expected)
    expect(Math.hypot(...expected.map((value: number, i: number) => value - candidate.pos[i]))).toBeGreaterThan(10)
    expect(model.addConfirmedComponent(handle.data.confirmedComponent, 'blue')).toBeTruthy()
    expect(model.addConfirmedComponent(handle.data.confirmedComponent, 'green')).toBeTruthy()
  })
})
