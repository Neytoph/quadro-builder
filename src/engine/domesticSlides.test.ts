import { describe, expect, it } from 'vitest'
import { BuildModel, SLIDE_SPECS } from './model.js'

describe('domestic slide geometry and matching run-out', () => {
  for (const [kind, drop, run] of [
    ['slide-domestic-classic60', 60, 120], ['slide-domestic-classic80', 80, 160],
  ] as const) {
    it(`${kind}: scales the original body and run-out as one assembly`, () => {
      const m = new BuildModel()
      const body = m.addSlide([20, drop + 5, 30], [1, 0, 0], kind, 'blue')!
      const exit = m.slideExit(body)!
      const end = m.addSlideAt('slide-end2', exit, 'blue')!
      const bodyMesh = m.slideMeshSpec(body), endMesh = m.slideMeshSpec(end)
      expect(bodyMesh.mesh).toBe('slide2')
      expect(endMesh.mesh).toBe('slide-end2')
      expect(endMesh.scale).toEqual(bodyMesh.scale)
      expect(bodyMesh.scale[0]).toBe(1)
      expect(80 * bodyMesh.scale[1]).toBeCloseTo(drop)
      expect((120 + 47.5) * bodyMesh.scale[2]).toBeCloseTo(run)
      expect(SLIDE_SPECS[kind].bodyRun + SLIDE_SPECS[kind].endRun).toBeCloseTo(run)
      expect(exit.pos[0] - body.x).toBeCloseTo(SLIDE_SPECS[kind].bodyRun, 1)

      const loaded = new BuildModel()
      expect(loaded.loadJSON(m.toJSON()).ok).toBe(true)
      expect(loaded.slideMeshSpec(loaded.slides.get(end.id)).scale).toEqual(endMesh.scale)
      expect(loaded.slides.get(end.id)?.color).toBe('blue')
    })

    it(`${kind}: upgrades the old buffer joint after a rotated saved design loads`, () => {
      const m = new BuildModel()
      const body = m.addSlide([100, drop + 5, 50], [-1, 0, 0], kind, 'red')!
      const spec = SLIDE_SPECS[kind]
      const end = m.addSlideAt('slide-end2', { pos: [100 - spec.legacyBodyRun, 5, 50], quat: body.quat }, 'yellow')!
      const unrelated = m.addSlideAt('slide-end2', { pos: [500, 0, 0] }, 'green')!
      const loaded = new BuildModel()
      loaded.loadJSON(m.toJSON())
      const upgraded = loaded.slides.get(end.id)!
      const target = loaded.slideExit(loaded.slides.get(body.id))!
      expect([upgraded.x, upgraded.y, upgraded.z]).toEqual(target.pos)
      expect(loaded.slideMeshSpec(upgraded).scale).toEqual(spec.scale)
      expect(loaded.slides.get(unrelated.id)).toMatchObject({ x: 500, y: 0, z: 0 })
      const again = new BuildModel()
      again.loadJSON(loaded.toJSON())
      expect(again.slides.get(end.id)).toEqual(upgraded)
    })
  }

  it('keeps an original buffer at its original scale and matches a domestic curved exit', () => {
    const m = new BuildModel()
    const original = m.addSlide([0, 85, 0], [0, 0, 1], 'slide2')!
    const end = m.addSlideAt('slide-end2', m.slideExit(original))!
    expect(m.slideMeshSpec(end).scale).toEqual([1, 1, 1])
    const curved = m.addSlide([300, 85, 0], [0, 0, 1], 'curved-slide-domestic80')!
    const curvedEnd = m.addSlideAt('slide-end2', m.slideExit(curved))!
    expect(m.slideMeshSpec(curved).mesh).toBe('curved-slide2')
    expect(m.slideMeshSpec(curvedEnd).scale).toEqual(m.slideMeshSpec(curved).scale)
  })

  it('can place a classic body when the design already contains an integral slide', () => {
    const m = new BuildModel()
    m.addSlide([0, 85, 0], [0, 0, 1], 'slide-new2')
    expect(m.addSlide([300, 65, 0], [0, 0, 1], 'slide-domestic-classic60')).not.toBeNull()
  })
})
