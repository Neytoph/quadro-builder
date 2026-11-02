import { beforeAll, describe, expect, it } from 'vitest'
import { buildableTubes, loadCatalog } from './catalog.js'
import { BuildModel, holeArmDirs } from './model.js'
import { createConfirmedComponentFixture } from './confirmedComponentExample.js'
import { componentMountsValid } from './accessoryPack.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { confirmedCandidates } from './confirmedComponentModel.js'
import { sectorScrewMounts } from './panelScrewMounts.js'

beforeAll(async () => { await loadCatalog() })

describe('风火轮和小扇形结构', () => {
  it.each([[0, 0, 1], [1, 0, 0], [0, 1, 0]])('风火轮可承接在连接件旁的轮轴承上，轴向 %j', (...dir) => {
    const model = new BuildModel()
    const root = model.addNode(0, 60, 0), end = model.addNode(-40, 60, 0)
    model.addTube(root.id, end.id, 'T35', 'blue', 35)
    const mount = model.fittingMounts('bearing2').find(m => 'nodeId' in m && m.nodeId === root.id && m.dir.every((v: number, i: number) => v === dir[i]))!
    const bearing = model.addFittingAt('bearing2', mount, 'red')!
    const wheelMount = model.fittingMounts('multi-wheel2').find(m => 'bearingId' in m && m.bearingId === bearing.id)!
    const hub = model.addWindmillAtBearing(bearing.id)!
    expect([hub.x, hub.y, hub.z]).toEqual(wheelMount.pos)
    expect(holeArmDirs(hub)).toHaveLength(4)
    expect(model.addWindmillAtBearing(bearing.id)).toBeNull()
    expect(model.addFittingAt('multi-wheel2', wheelMount, 'blue')).toBeNull()
    const spoke = model.extend(hub.id, holeArmDirs(hub)[0], 'T15', 'red', 15, 20)!
    expect(spoke.tube).toBeTruthy()
    const fixed = structuredClone([root, end, bearing])
    expect(model.turnHoleClamp(hub.id, Math.PI / 4)).toBe(true)
    expect([root, end, bearing]).toEqual(fixed)
    expect([...model.collisions()]).toEqual([])
    const saved = new BuildModel()
    expect(saved.loadJSON(model.toJSON()).ok).toBe(true)
    expect(saved.turnHoleClamp(hub.id)).toBe(true)
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    const inserted = model.insertFragment(model.extractSelection(selection)!, [160, 80, 0])!
    const copied = inserted.nodes.map((id: string) => model.nodes.get(id)).find(n => n.part === 'windmill')!
    expect(model.turnHoleClamp(copied.id)).toBe(true)
    const qdf = buildQDF(saved)
    expect(qdf.warnings).toEqual([])
    const imported = new BuildModel()
    expect(imported.loadJSON(parseQDF(qdf.text, { tubes: buildableTubes() })).ok).toBe(true)
    const importedHub = [...imported.nodes.values()].find(n => n.part === 'windmill')!
    expect(importedHub.clampOn).toBeFalsy()
    expect(imported.turnHoleClamp(importedHub.id)).toBe(true)
  })

  it('轴承已安装多向轮时不再提供风火轮安装点', () => {
    const model = new BuildModel()
    model.addNode(0, 60, 0)
    const bearing = model.addFittingAt('bearing2', model.fittingMounts('bearing2')[0], 'red')!
    const mount = model.windmillBearingMounts()[0]
    expect(mount.bearingId).toBe(bearing.id)
    model.addFittingAt('multi-wheel2', mount, 'blue')
    expect(model.windmillBearingMounts()).toEqual([])
    expect(model.addWindmillAtBearing(bearing.id)).toBeNull()
    expect(model.addWindmillAtBearing('missing')).toBeNull()
  })

  it('中心安装在固定管上，四个接口及连接的短管一起旋转', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 50, -20), b = model.addNode(0, 50, 20)
    const shaft = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    expect(model.addTubeClamp(shaft.id, [0, 50, -20], 'windmill')).toBeNull()
    const hub = model.addTubeClamp(shaft.id, [2.45, 50, 0], 'windmill')!
    expect([hub.x, hub.y, hub.z]).toEqual([0, 50, 0])
    expect(holeArmDirs(hub)).toHaveLength(4)
    const end = model.addNode(20, 50, 0)
    const spoke = model.addTube(hub.id, end.id, 'T15', 'red', 15)!
    expect(model.rotateTubeClamp(hub.id, 5, Math.PI / 2)).toBe(true)
    expect(model.nodes.get(end.id)!.x).toBeCloseTo(0)
    expect(Math.abs(model.nodes.get(end.id)!.y - 50)).toBeCloseTo(20)
    expect(model.tubes.get(shaft.id)).toBe(shaft)
    expect(model.tubes.get(spoke.id)).toBe(spoke)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(holeArmDirs(reopened.nodes.get(hub.id))).toHaveLength(4)
    expect(reopened.nodes.get(hub.id)!.clampOn.tubeId).toBe(shaft.id)
    const imported = new BuildModel()
    expect(imported.loadJSON(parseQDF(buildQDF(model).text, { tubes: buildableTubes() })).ok).toBe(true)
    const importedHub = [...imported.nodes.values()].find(node => node.part === 'windmill')!
    expect(importedHub.clampOn).toBeTruthy()
    const importedShaft = imported.tubes.get(importedHub.clampOn.tubeId)!
    expect(importedShaft.tubeId).toBe('T35')
    expect([...imported.tubes.values()].map(t => t.tubeId)).toContain('T15')
    const importedSpoke = [...imported.tubes.values()].find(t => t.tubeId === 'T15')!
    expect([importedSpoke.a, importedSpoke.b]).toContain(importedHub.id)
    expect(imported.rotateTubeClamp(importedHub.id, 5, Math.PI / 2)).toBe(true)
  })

  it('小扇形板以两根15厘米管固定，并可保存重开', () => {
    const { model, part } = createConfirmedComponentFixture('panel_sector_20')
    expect(part.supportTubes.map((id: string) => model.tubes.get(id)!.tubeId).sort()).toEqual(['T15', 'T15'])
    expect(part.mounts.filter((mount: {role: string}) => mount.role === 'panel-screw')).toHaveLength(4)
    expect(componentMountsValid(model, part)).toBe(true)
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(componentMountsValid(reopened, reopened.fittings.get(part.id))).toBe(true)
    const imported = new BuildModel()
    const qdf = buildQDF(model)
    expect(qdf.warnings.some((warning: { partId: string }) => warning.partId === 'panel_sector_20')).toBe(true)
    expect(imported.loadJSON(parseQDF(qdf.text, { tubes: buildableTubes() })).ok).toBe(true)
    expect([...imported.tubes.values()].some(tube => tube.tubeId === 'TC15')).toBe(true)
  })

  it.each(['panel_sector_20', 'panel_sector_40'])('旧版 %s 存档仍可打开并显示两条直边的螺丝', id => {
    const { model, part } = createConfirmedComponentFixture(id)
    const legacy = confirmedCandidates(model, id, { legacySector: true }).find((candidate: any) =>
      candidate.a === part.a && candidate.b === part.b && candidate.pos.every((v: number, i: number) => Math.abs(v - [part.x, part.y, part.z][i]) < .01))!
    expect(legacy).toBeTruthy()
    part.mounts = legacy.mounts
    part.supportTubes = legacy.supportTubes
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    const saved = reopened.fittings.get(part.id)!
    expect(componentMountsValid(reopened, saved)).toBe(true)
    const mounts = sectorScrewMounts(reopened, saved)
    expect(mounts).toHaveLength(4)
    expect(new Set(mounts.map((mount: {tube: string}) => mount.tube))).toEqual(new Set([saved.a, saved.b]))
    const arc = [...reopened.tubes.values()].find(tube => tube.bow)!
    reopened.removeTube(arc.id)
    expect(reopened.fittings.has(saved.id)).toBe(true)
    expect(componentMountsValid(reopened, saved)).toBe(true)
  })

  it('四个风火轮接口可分别连接短管并绕固定轴一起转动', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 60, -20), b = model.addNode(0, 60, 20)
    const shaft = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const hub = model.addTubeClamp(shaft.id, [2.45, 60, 0], 'windmill')!
    const ends = holeArmDirs(hub).map((dir: number[]) => {
      const extension = model.extend(hub.id, dir, 'T15', 'red', 15, 20)
      expect(extension?.tube).toBeTruthy()
      return extension!.node!.id
    })
    const original = ends.map((id: string) => model.nodePos(id))
    expect([...model.collisions()]).toEqual([])
    expect(model.rotateTubeClamp(hub.id, 5, Math.PI / 2)).toBe(true)
    expect(ends.map((id: string) => model.nodePos(id))).not.toEqual(original)
    expect(model.nodePos(a.id)).toEqual([0, 60, -20])
    expect(model.nodePos(b.id)).toEqual([0, 60, 20])
    const selection = new Map([...model.nodes.keys()].map(id => [id, 'node']))
    const fragment = model.extractSelection(selection)!
    const inserted = model.insertFragment(fragment, [100, 60, 0])!
    const copy = inserted.nodes.map((id: string) => model.nodes.get(id)).find((node: {part: string}) => node?.part === 'windmill')!
    expect(copy.clampOn.tubeId).not.toBe(shaft.id)
    expect(inserted.tubes).toContain(copy.clampOn.tubeId)
    expect(model.rotateTubeClamp(copy.id, 5, Math.PI / 2)).toBe(true)
  })

  it('连接风火轮的四分之一圆和小板可以整体转动', () => {
    const model = new BuildModel()
    const a = model.addNode(0, 60, -20), b = model.addNode(0, 60, 20)
    const shaft = model.addTube(a.id, b.id, 'T35', 'blue', 35)!
    const hub = model.addTubeClamp(shaft.id, [2.45, 60, 0], 'windmill')!
    const x = model.extend(hub.id, [1, 0, 0], 'T15', 'red', 15, 20)!
    model.extend(hub.id, [0, 1, 0], 'T15', 'red', 15, 20)
    const arc = model.extendBow(x.node!.id, [0, 1, 0], [-1, 0, 0], 'TC15', 'blue', 20)!
    expect(arc.tube).toBeTruthy()
    const mount = model.confirmedMounts('panel_sector_20').find((candidate: {valid: boolean}) => candidate.valid)
    expect(mount).toBeTruthy()
    const panel = model.addConfirmedComponent(mount, 'blue')!
    expect(model.rotateTubeClamp(hub.id, 5, Math.PI / 2)).toBe(true)
    expect(componentMountsValid(model, panel)).toBe(true)
    expect(model.nodePos(a.id)).toEqual([0, 60, -20])
    const saved = new BuildModel()
    expect(saved.loadJSON(model.toJSON()).ok).toBe(true)
    expect(componentMountsValid(saved, saved.fittings.get(panel.id))).toBe(true)
  })
})
