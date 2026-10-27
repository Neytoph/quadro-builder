import { describe, expect, it, vi } from 'vitest'
import { Builder } from './builder.js'

const hit = (kind: string, id: string) => ({ data: { kind, id } })

describe('panel placement picking', () => {
  it('picks a tube behind a slide, while preserving panel clicks', () => {
    const builder = Object.create(Builder.prototype)
    const slide = hit('slide', 'slide'), tube = hit('tube', 'rail'), panel = hit('panel', 'panel')
    builder._panelGuideIds = null
    builder.scene = { pickForDelete: vi.fn(() => slide), pickTube: vi.fn(() => tube) }
    expect(builder._pickPanelPlacement(10, 20)).toBe(tube)
    builder.scene.pickForDelete.mockReturnValue(panel)
    expect(builder._pickPanelPlacement(10, 20)).toBe(panel)
    expect(builder.scene.pickTube).toHaveBeenCalledTimes(1)
  })

  it('prioritizes highlighted candidate rails', () => {
    const builder = Object.create(Builder.prototype)
    const tube = hit('tube', 'partner')
    builder._panelGuideIds = new Set(['partner'])
    builder.scene = { pickAmong: vi.fn(() => tube), pickForDelete: vi.fn() }
    expect(builder._pickPanelPlacement(10, 20)).toBe(tube)
    expect(builder.scene.pickForDelete).not.toHaveBeenCalled()
  })
})
