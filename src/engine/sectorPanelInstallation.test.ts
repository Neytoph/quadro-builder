import { beforeAll, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { confirmedFittingHandlePosition } from './builder.js'
import { componentMountsValid } from './accessoryPack.js'
import { computeBOM } from './bom.js'

beforeAll(loadCatalog)

it.each([['panel_sector_20', 'T15', 15, 20], ['panel_sector_40', 'T35', 35, 40]])(
  '%s 的相邻安装位分开显示，并能共用一条直管', (id, tubeId, length, radius) => {
    const model = new BuildModel()
    const center = model.addNode(0, 80, 0)
    for (const [x, y] of [[radius, 80], [-radius, 80], [0, 80 + radius]]) {
      const end = model.addNode(x, y, 0)
      expect(model.addTube(center.id, end.id, tubeId, 'blue', length)).toBeTruthy()
    }
    const initial = model.confirmedMounts(id).filter((mount: any) => mount.valid)
    expect(initial).toHaveLength(2)
    const positions = initial.map((mount: any) => confirmedFittingHandlePosition(model, mount))
    expect(positions[0]).not.toEqual(positions[1])
    expect(positions.every((position: number[]) => Math.abs(position[0]) > radius * .3 && position[1] > 80)).toBe(true)
    const first = model.addConfirmedComponent(initial[0], 'blue')!
    const next = model.confirmedMounts(id).find((mount: any) => mount.valid)
    expect(next).toBeTruthy()
    const second = model.addConfirmedComponent(next, 'green')!
    expect(componentMountsValid(model, first)).toBe(true)
    expect(componentMountsValid(model, second)).toBe(true)
    expect(first.supportTubes.filter((tube: string) => second.supportTubes.includes(tube))).toHaveLength(1)
    const fragment = model.extractSelection(new Map([...model.nodes.keys()].map(node => [node, 'node'])))!
    const inserted = model.insertFragment(fragment, [150, 80, 0])!
    const copies = inserted.fittings.map((id: string) => model.fittings.get(id)).filter(Boolean)
    expect(copies).toHaveLength(2)
    expect(copies.every((panel: any) => componentMountsValid(model, panel))).toBe(true)
    const row = computeBOM(model).fittings.find((item: any) => item.def?.id === id || item.partId === id || item.id === id)
    expect(row?.count).toBe(4)
  },
)
