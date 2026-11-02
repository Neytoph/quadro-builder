import { beforeAll, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { createDirectInstallationFrame } from './directInstallationExample.js'

beforeAll(loadCatalog)

// 使用真实安装、障碍管和保存重开，核验批次内复用不会沿用旧模型的可安装结果。
it.each(['panel_40x40', 'panel_40x40_clock', 'acrylic_panel_40x40'])('%s 每次枚举重新读取占用、删除和模型替换', id => {
  const model = createDirectInstallationFrame(80, 40, { vertical: true })
  const openings = () => model.panelAccessoryMounts(id, { screwAxis: 'auto', oppositeRetainers: true })
  const initial = openings(), saved = model.toJSON()
  expect(initial.length).toBeGreaterThan(1)
  const first = initial[0], placed = model.addPanelAccessory(first, 'blue')!
  expect(placed).toBeTruthy()
  const occupied = openings()
  expect(occupied.length).toBeLessThan(initial.length)
  expect(occupied.some(p => Math.hypot(...p.pos.map((v: number, i: number) => v - first.pos[i])) < .01)).toBe(false)
  model.removePanel(placed.id)
  expect(openings()).toEqual(initial)

  const x = first.pos[0], y = first.pos[1], z = first.pos[2]
  const a = model.addNode(x, y, z - 10), b = model.addNode(x, y, z + 10)
  const tube = model.addTube(a.id, b.id, 'T15', 'red', 15)!
  expect(tube).toBeTruthy()
  expect(openings().some(p => Math.hypot(...p.pos.map((v: number, i: number) => v - first.pos[i])) < .01)).toBe(false)
  expect(model.loadJSON(saved).ok).toBe(true)
  expect(openings()).toEqual(initial)
})
