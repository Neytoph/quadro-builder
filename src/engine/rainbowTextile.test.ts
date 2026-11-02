import { describe, expect, it } from 'vitest'
import { rainbowRibbonLayout, RAINBOW_RIBBON_WIDTH_CM, RAINBOW_CONNECTOR_CLEARANCE_CM, createRainbowRibbonSheet, createRainbowRibbonSleeve } from './rainbowTextile.js'

describe('彩虹门布带外形', () => {
  it.each([5.1, 20, 29.99, 30, 40, 80, 200])('宽%s厘米时单根宽度恒定，布条互不交叠', along => {
    const strips = rainbowRibbonLayout(along)
    const inset = Math.min(2.5 + RAINBOW_CONNECTOR_CLEARANCE_CM, along * .4)
    for (let i = 0; i < strips.length; i++) {
      const s = strips[i]
      expect(s.width).toBe(RAINBOW_RIBBON_WIDTH_CM)
      expect(s.center - s.width / 2).toBeGreaterThanOrEqual(inset - 1e-9)
      expect(s.center + s.width / 2).toBeLessThanOrEqual(along - inset + 1e-9)
      if (i) expect(s.center - s.width / 2 - strips[i - 1].center - strips[i - 1].width / 2).toBeGreaterThanOrEqual(.4 - 1e-9)
    }
  })

  it('25厘米管铺五条固定宽度彩带，完整覆盖管身', () => {
    const strips = rainbowRibbonLayout(30)
    expect(strips).toHaveLength(5)
    expect(strips[0].center - strips[0].width / 2).toBeCloseTo(2.65, 8)
    expect(strips.at(-1)!.center + strips.at(-1)!.width / 2).toBeCloseTo(27.35, 8)
    expect(rainbowRibbonLayout(40)).toHaveLength(7)
  })

  it.each([20, 40, 60])('相距%s厘米时布带保持框架中间平面，端头止于套环内侧', span => {
    const radius = 2.57, sheet = createRainbowRibbonSheet(2.35, span, radius)
    const p = sheet.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i)
      expect(y).toBeCloseTo(0, 6)
      expect(Math.hypot(y, Math.min(Math.abs(z), Math.abs(span - z)))).toBeGreaterThan(2.45)
      expect(Math.min(Math.abs(z), Math.abs(span - z))).toBeCloseTo(radius, 5)
    }
    const sleeve = createRainbowRibbonSleeve(2.35, radius), s = sleeve.attributes.position
    for (let i = 0; i < s.count; i++) {
      expect(Math.hypot(s.getY(i), s.getZ(i))).toBeCloseTo(radius, 5)
      expect(Math.abs(s.getX(i))).toBeLessThanOrEqual(2.35 / 2 + 1e-6)
    }
    sheet.dispose(); sleeve.dispose()
  })
})
