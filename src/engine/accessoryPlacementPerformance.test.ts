import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from './catalog.js'
import { Builder } from './builder.js'
import { CONFIRMED_COMPONENTS } from './componentPack.js'
import { createConfirmedComponentFixture, createRetainedComponentFixture } from './confirmedComponentExample.js'

beforeAll(() => loadCatalog())
const fittings = CONFIRMED_COMPONENTS.filter(spec => spec.placement === 'fitting')

describe('配件候选检查复用', () => {
  for (const spec of fittings.filter(spec => spec.id !== 'rope')) it(`${spec.id}批量诊断与单件重新验证一致，支撑变化后不复用旧结果`, () => {
    const { model, candidate } = createConfirmedComponentFixture(spec.id, { install: false })
    const check = () => {
      const mounts = model.confirmedMounts(spec.id)
      for (const mount of mounts) expect(mount).toEqual(model.confirmedDiagnostics(mount))
      return mounts
    }
    expect(check().some(mount => mount.valid)).toBe(true)
    const added = model.addConfirmedComponent(candidate, 'blue')!
    expect(added).toBeTruthy()
    check()
    model.removeFitting(added.id)
    const saved = model.toJSON()
    for (const id of candidate.supportTubes) model.removeTube(id)
    expect(model.confirmedDiagnostics(candidate).valid).toBe(false)
    check()
    expect(model.loadJSON(saved).ok).toBe(true)
    expect(check().some(mount => mount.valid)).toBe(true)
  })

  it('安装提示复用本次真实候选，切换和刷新后重新计算', () => {
    const { model } = createConfirmedComponentFixture('trampoline', { install: false })
    const builder = Object.create(Builder.prototype), handles: unknown[] = [], notices: string[] = []
    Object.assign(builder, { model, scene: { addHandle: (...args: unknown[]) => handles.push(args), clearInstallationPreview() {} }, mode: 'fitting', fittingKind: 'trampoline', fittingPart: 'trampoline', onNotice: (text: string) => notices.push(text) })
    builder._buildFittingHandles(); builder._hintPlaceMode()
    expect(handles.length).toBeGreaterThan(0); expect(notices).toHaveLength(0)
    const candidate = handles[0] as [unknown, { confirmedComponent: ReturnType<typeof model.confirmedMounts>[number] }]
    expect(model.addConfirmedComponent(candidate[1].confirmedComponent, 'blue')).toBeTruthy()
    for (const id of [...model.tubes.keys()]) model.removeTube(id)
    builder._buildFittingHandles(); builder._hintPlaceMode(); expect(notices).toHaveLength(1)
    builder.setFitting('sleeve', 'sleeve', { refresh: false })
    builder._buildFittingHandles(); builder._hintPlaceMode()
    expect(builder._confirmedFittingMounts.id).toBe('sleeve')
  })

  it('从带具体型号的配件切到泳池及海洋球时清除前一型号', () => {
    const model = createRetainedComponentFixture('ocean_balls'), builder = Object.create(Builder.prototype)
    Object.assign(builder, { model, scene: { clearInstallationPreview() {}, addPanelHandle() {} }, mode: 'fitting', fittingKind: 'trampoline', fittingPart: 'trampoline', onNotice() {}, cancelPaste() {}, setMode(mode: string) { builder.mode = mode; builder._buildFittingHandles() } })
    expect(builder.startPool('balls')).toBe('mount'); expect(builder.fittingPart).toBeNull()
    expect(builder.fittingKind).toBe('balls'); expect(builder.poolLinerId).toBe('balls')
    for (const part of [...model.fittings.values()]) model.removeFitting(part.id)
    builder.setFitting('sleeve', 'sleeve', { refresh: false })
    expect(builder.startPool('pool_liner_xs')).toBe('mount'); expect(builder.fittingPart).toBeNull()
    expect(builder.poolLinerId).toBe('pool_liner_xs'); expect(builder._confirmedFittingMounts).toBeNull()
  })
})
