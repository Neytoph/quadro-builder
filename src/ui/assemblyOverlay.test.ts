import { expect, it } from 'vitest'
import { layoutAssemblyMarks } from './assemblyOverlay'

it('手机密集固定标号可以逐个辨认，且引线保留实际连接位置', () => {
  const marks = Array.from({ length: 12 }, (_, i) => ({ x: 190 + i % 3, y: 180 + i % 2, label: `F${i + 1}` }))
  const placed = layoutAssemblyMarks(marks, 390, 338)
  expect(placed.map(mark => [mark.anchorX, mark.anchorY])).toEqual(marks.map(mark => [mark.x, mark.y]))
  for (const [i, mark] of placed.entries()) {
    expect(mark.x).toBeGreaterThanOrEqual(13)
    expect(mark.x).toBeLessThanOrEqual(377)
    expect(mark.y).toBeGreaterThanOrEqual(13)
    expect(mark.y).toBeLessThanOrEqual(325)
    for (const other of placed.slice(0, i)) expect(Math.hypot(mark.x - other.x, mark.y - other.y)).toBeGreaterThanOrEqual(27)
  }
})

it('PDF 大标号靠近边角时完整留在画框内，引线仍指向原位置', () => {
  const radius = 16.5
  const marks = [0, 1, 2].map(i => ({ x: 2 + i, y: 1, label: `F${135 + i}` }))
  const placed = layoutAssemblyMarks(marks, 1400, 1200, { radius, gap: 2.5 })
  for (const [i, mark] of placed.entries()) {
    expect(mark.x - radius).toBeGreaterThan(0)
    expect(mark.y - radius).toBeGreaterThan(0)
    expect(mark.x + radius).toBeLessThan(1400)
    expect(mark.y + radius).toBeLessThan(1200)
    expect([mark.anchorX, mark.anchorY]).toEqual([marks[i].x, marks[i].y])
    for (const other of placed.slice(0, i)) expect(Math.hypot(mark.x - other.x, mark.y - other.y)).toBeGreaterThanOrEqual(radius * 2 + 2.5)
  }
})
