import { expect, it } from 'vitest'
import { manualReadingPageBox } from './assemblyManual.js'

it('局部定位图的独立安全栏不会覆盖任何一幅主图或标题，保持相同图幅', () => {
  for (const header of [20, 48]) {
    const box = manualReadingPageBox(60, header, true)
    if (!('locator' in box)) throw new Error('Local page has no locator column')
    expect(box.x0 + box.imgW).toBeLessThan(box.x1)
    expect(box.x1 + box.imgW + 2).toBeLessThanOrEqual(box.locator.x)
    expect(box.locator.x + box.locator.width).toBeLessThanOrEqual(290)
    expect(box.locator.y).toBeGreaterThan(header)
    expect(box.locator.width / box.locator.height).toBe(35 / 29)
    expect(box.imgW).toBeGreaterThan(120)
    expect(box.imgY + box.imgH + box.partsH).toBe(207)
  }
})
