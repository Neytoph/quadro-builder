import { beforeAll, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { confirmedFittingHandlePosition } from './builder.js'
import { componentMountsValid } from './accessoryPack.js'
import { computeBOM } from './bom.js'
import { panelInstallationFacing } from './panelInstallationFacing.js'
import { zAxisOf } from './util.js'
import { Builder } from './builder.js'

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

it.each([['panel_sector_20', 1], ['panel_sector_20', -1], ['panel_sector_40', 1], ['panel_sector_40', -1]])('%s 四块可以从 %i 侧安装、保存与翻面', (id, side) => {
  const radius = id === 'panel_sector_20' ? 20 : 40
  const model = new BuildModel(), center = model.addNode(0, 80, 0)
  for (const [x, y] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    const end = model.addNode(x, 80 + y, 0)
    model.addTube(center.id, end.id, radius === 20 ? 'T15' : 'T35', 'blue', radius - 5)
  }
  const installed: string[] = []
  for (let i = 0; i < 4; i++) {
    const candidate = model.confirmedMounts(id).map((mount: any) => panelInstallationFacing(model, mount, [0, 80, side * 100]).part)
      .find((mount: any) => mount.valid)
    expect(candidate).toBeTruthy()
    const panel = model.addConfirmedComponent(candidate, 'blue')!
    expect(zAxisOf(panel.quat)[2]).toBeCloseTo(side)
    installed.push(panel.id)
  }
  const reopened = new BuildModel()
  expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
  for (const id of installed) {
    const panel = reopened.fittings.get(id)!
    expect(componentMountsValid(reopened, panel)).toBe(true)
    expect(zAxisOf(panel.quat)[2]).toBeCloseTo(side)
  }
  const first = reopened.fittings.get(installed[0])!
  expect(reopened.canRotateFitting(first.id)).toBe(true)
  expect(reopened.rotateFitting(first.id)).toBe(true)
  expect(zAxisOf(first.quat)[2]).toBeCloseTo(-side)
  expect(componentMountsValid(reopened, first)).toBe(true)
  expect(reopened.rotateFitting(first.id)).toBe(true)
  expect(zAxisOf(first.quat)[2]).toBeCloseTo(side)
})

it('首选正面被管子挡住时，安装点保留可用反面', () => {
  const model = new BuildModel(), center = model.addNode(0, 80, 0)
  const x = model.addNode(20, 80, 0), y = model.addNode(0, 100, 0)
  model.addTube(center.id, x.id, 'T15', 'blue', 15)
  model.addTube(center.id, y.id, 'T15', 'blue', 15)
  const a = model.addNode(3, 90, 4), b = model.addNode(18, 90, 4)
  model.addTube(a.id, b.id, 'T10', 'red', 10)
  const candidate = model.confirmedMounts('panel_sector_20').find((p: any) => p.a && p.b && p.pos[0] === 0 && p.pos[1] === 80)!
  expect(candidate.valid).toBe(false)
  const alternative = panelInstallationFacing(model, candidate, [0, 80, 100])
  expect(alternative.part.valid).toBe(true)
  expect(alternative.conflict).toBeTruthy()
  expect(zAxisOf(alternative.part.quat)[2]).toBeCloseTo(-1)
  const builder = Object.create(Builder.prototype)
  const handles: any[] = []
  Object.assign(builder, { model, fittingKind: 'panel_sector_20', fittingPart: 'panel_sector_20',
    scene: { cameraPosition: () => [0, 80, 100], addHandle: (_position: number[], data: any) => handles.push(data) } })
  builder._buildFittingHandles()
  expect(handles.some(handle => handle.confirmedComponent.valid)).toBe(true)
  expect(builder._confirmedFittingMounts.mounts.some((mount: any) => mount.valid)).toBe(true)
})

it.each(['x', 'z'])('整块镜像 %s 时扇板朝向随结构镜像', axis => {
  const model = new BuildModel(), center = model.addNode(0, 80, 0)
  const x = model.addNode(20, 80, 0), y = model.addNode(0, 100, 0)
  model.addTube(center.id, x.id, 'T15', 'blue', 15)
  model.addTube(center.id, y.id, 'T15', 'blue', 15)
  const mount = model.confirmedMounts('panel_sector_20').find((p: any) => p.valid)!
  const panel = model.addConfirmedComponent(panelInstallationFacing(model, mount, [0, 80, 100]).part, 'blue')!
  const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
  expect(model.mirrorSelection(selection, axis).ok).toBe(true)
  expect(zAxisOf(panel.quat)[2]).toBeCloseTo(axis === 'x' ? 1 : -1)
  expect(componentMountsValid(model, panel)).toBe(true)
  expect(model.mirrorSelection(selection, axis).ok).toBe(true)
  expect(zAxisOf(panel.quat)[2]).toBeCloseTo(1)
})
