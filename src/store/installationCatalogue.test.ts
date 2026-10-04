import { beforeAll, expect, it } from 'vitest'
import { accessories, allConnectors, buildableCurvedTubes, buildablePanels, buildableTubes, loadCatalog } from '../engine/catalog.js'
import { setLang } from '../engine/i18n.js'
import { isNewComponent } from './newComponentStatus'
import { installationCatalogueStrings } from '../ui/installationCatalogueStrings'
import type { useEngine } from './EngineContext'
import { INSTALLATION_CATALOGUE, installationActive, installationChoices, searchInstallation, selectInstallation } from './installationCatalogue'

type EngineApi = ReturnType<typeof useEngine>
beforeAll(async () => { await loadCatalog() })

// 使用仓库真实目录；仅隔离检查菜单调用与状态匹配，不作为三维安装成功证据。
function routingApi() {
  const api = {
    catalog: { tubes: buildableTubes(), curved: buildableCurvedTubes(), panels: buildablePanels(), connectors: allConnectors(), accessories: accessories() },
    readOnly: false, mode: 'select', panelId: '', tubeId: '', fittingKind: '', fittingPart: null as string | null, poolLinerId: null as string | null, slideKind: '', clampPart: '', placingConnector: null as string | null, pasting: false,
    setPanel(id: string) { this.mode = 'panel'; this.panelId = id },
    setTube(id: string) { this.mode = 'add'; this.tubeId = id },
    setFitting(kind: string, partId?: string) { this.mode = 'fitting'; this.fittingKind = kind; this.fittingPart = partId || null },
    setSlide(id: string) { this.mode = 'slide'; this.slideKind = id },
    setClamp(id: string) { this.mode = 'clamp'; this.clampPart = id },
    startPool(id: string) { this.mode = 'fitting'; this.poolLinerId = id },
    placeConnector(id: string) { this.mode = 'add'; this.placingConnector = id },
    startC45() { this.mode = 'c45' },
  }
  return api as unknown as EngineApi
}

it('91个真实物理件各归属一次，数量与确认方案完整一致', () => {
  const entries = installationChoices(routingApi(), key => key)
  expect(entries).toHaveLength(91)
  expect(new Set(entries.map(entry => entry.id)).size).toBe(91)
  expect(Object.fromEntries([...new Set(entries.map(entry => entry.tool))].map(tool => [tool, entries.filter(entry => entry.tool === tool).length]))).toEqual({ panels:24, accessories:10, textiles:13, wheels:7, slides:4, pools:5, tubes:10, connectors:18 })
  expect(entries.filter(entry => entry.group === 'outside')).toHaveLength(16)
  expect(entries.filter(entry => entry.group === 'inset')).toHaveLength(8)
  expect(entries.filter(entry => entry.group === 'on-tube')).toHaveLength(4)
  expect(entries.filter(entry => entry.group === 'on-frame')).toHaveLength(3)
  expect(entries.filter(entry => entry.group === 'auxiliary')).toHaveLength(3)
})

it('已核对来源不随新版compat覆盖：官方套装与扩展整块透明板正确区分', () => {
  const byId = new Map(INSTALLATION_CATALOGUE.map(entry => [entry.id, entry]))
  for (const id of ['wheel','textile','lattice','hole_panel_40x40','slide_integral']) expect(byId.get(id)?.origin).toBe('official')
  for (const id of ['acrylic_panel_40x40','TA35','TA75','trampoline','panel_40x40_pocket']) expect(byId.get(id)?.origin).toBe('extended')
})

it('全库三语名称与组合别名搜索，荡桥只找到绳子', () => {
  for (const lang of ['zh','en','de']) {
    setLang(lang)
    const entries = installationChoices(routingApi(), key => key)
    for (const query of ['荡桥','suspension bridge','Hängebrücke']) expect(entries.filter(entry => searchInstallation(entry, query)).map(entry => entry.id)).toEqual(['rope'])
    expect(entries.filter(entry => searchInstallation(entry, 'LEGO')).map(entry => entry.id)).toEqual(['panel_40x40_lego'])
    expect(entries.filter(entry => searchInstallation(entry, '太空舱')).map(entry => entry.id)).toEqual(['panel_40x40_capsule'])
    expect(entries.filter(entry => searchInstallation(entry, '  acrylic 40x60  ')).map(entry => entry.id)).toEqual(['acrylic_panel_40x60'])
    const capsule = entries.find(entry => entry.id === 'panel_40x40_capsule')!
    expect(searchInstallation(capsule, capsule.choice.label)).toBe(true)
  }
  setLang('zh')
})

it('全部91项路由可进入对应真实选择API，匹配选择状态', () => {
  const entries = installationChoices(routingApi(), key => key)
  for (const entry of entries) {
    const api = routingApi()
    expect(selectInstallation(entry, api), entry.id).toBe(true)
    expect(installationActive(entry, api), entry.id).toBe(true)
  }
})

it('真实多向轮目录沿用原生入口、官方来源和轮分类，三语可查安装方法', () => {
  const api = routingApi()
  const wheel = installationChoices(api, key => key).find(entry => entry.id === 'wheel')!
  expect(wheel.origin).toBe('official')
  expect(wheel.tool).toBe('wheels')
  expect(isNewComponent(wheel.id)).toBe(false)
  expect(wheel.choice.action).toEqual({ kind: 'fitting', id: 'multi-wheel2', partId: undefined })
  for (const query of ['多向轮', 'multi wheel', 'Multirad']) expect(searchInstallation(wheel, query)).toBe(true)
  expect(wheel.method).toBe('管上或轴承')
  for (const copy of Object.values(installationCatalogueStrings)) expect(copy[wheel.method as keyof typeof copy]).toBeTruthy()
  expect(selectInstallation(wheel, api)).toBe(true)
  expect(api.fittingKind).toBe('multi-wheel2')
  expect(api.fittingPart).toBeNull()
  expect(installationActive(wheel, api)).toBe(true)
})

it('跨入口搜索选择panel型框面和布兜时，高亮落实际配件/布艺分类', () => {
  for (const [id, tool] of [['panel_40x40_sensory','accessories'], ['panel_40x40_basin','accessories'], ['panel_40x40_pocket','textiles']]) {
    const api = routingApi(), entries = installationChoices(api, key => key)
    selectInstallation(entries.find(entry => entry.id === id)!, api)
    expect(api.mode).toBe('panel')
    expect(entries.find(entry => installationActive(entry, api))?.tool).toBe(tool)
  }
})

it('只读时搜索选择不会修改引擎状态', () => {
  const api = routingApi(); api.readOnly = true
  const entries = installationChoices(api, key => key)
  for (const entry of entries) expect(selectInstallation(entry, api)).toBe(false)
  expect(api.mode).toBe('select')
})
