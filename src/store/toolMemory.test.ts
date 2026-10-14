import { beforeAll, expect, it } from 'vitest'
import { accessories, allConnectors, buildableCurvedTubes, buildablePanels, buildableTubes, loadCatalog } from '../engine/catalog.js'
import { installationChoices } from './installationCatalogue'
import { captureTool, FULL_PANEL, NUMBER_TUBES, ToolMemory, toolForKey, type ToolState } from './toolMemory'
import type { useEngine } from './EngineContext'

beforeAll(async () => { await loadCatalog() })
const state = (changes: Partial<ToolState> = {}): ToolState => ({ mode: 'select', panelId: FULL_PANEL, tubeId: 'T35', slideKind: 'slide-new2',
  clampPart: 'double_tube', placingConnector: null, fittingKind: 'multi-wheel2', fittingPart: null, poolLinerId: null,
  pasting: false, color: 'red', insetScrewAxis: 'horizontal', ...changes })
const entries = () => installationChoices({ catalog: { tubes: buildableTubes(), curved: buildableCurvedTubes(), panels: buildablePanels(),
  connectors: allConnectors(), accessories: accessories() } } as ReturnType<typeof useEngine>, key => key)

it('记住真实连接件身份、跨分类面板和安装参数，临时状态不覆盖记录', () => {
  const choices = entries()
  expect(captureTool(state({ mode: 'add', placingConnector: '3way' }), choices)).toMatchObject({ tool: 'connectors', partId: '3way' })
  expect(captureTool(state({ mode: 'panel', panelId: 'panel_40x40_pocket' }), choices)).toMatchObject({ tool: 'textiles', partId: 'panel_40x40_pocket', insetScrewAxis: 'horizontal' })
  expect(captureTool(state({ mode: 'fitting', fittingKind: 'textil2', fittingPart: 'textile_rainbow' }), choices)).toMatchObject({ tool: 'textiles', partId: 'textile_rainbow', fittingPart: 'textile_rainbow' })
  expect(captureTool(state({ mode: 'slide', slideKind: 'curved-slide-domestic80' }), choices)).toMatchObject({ tool: 'slides', partId: 'curved-slide-domestic80' })
  for (const mode of ['select', 'delete', 'assembly']) expect(captureTool(state({ mode }), choices)).toBeNull()
  expect(captureTool(state({ mode: 'add', pasting: true }), choices)).toBeNull()
})

it('各模型和各分类记录独立，退出临时模式后仍能返回上次配件', () => {
  const memory = new ToolMemory(), choices = entries()
  memory.remember('A', captureTool(state({ mode: 'add', tubeId: 'T25' }), choices))
  memory.remember('A', captureTool(state({ mode: 'panel', color: 'blue' }), choices))
  memory.remember('B', captureTool(state({ mode: 'slide', slideKind: 'slide-domestic-classic80' }), choices))
  memory.remember('A', captureTool(state({ mode: 'delete' }), choices))
  expect(memory.get('A')).toMatchObject({ tool: 'panels', color: 'blue' })
  expect(memory.get('A', 'tubes')).toMatchObject({ partId: 'T25', color: 'red' })
  expect(memory.get('B')).toMatchObject({ tool: 'slides', partId: 'slide-domestic-classic80' })
  const copy = memory.get('A')!
  copy.partId = 'changed'
  expect(memory.get('A')?.partId).toBe(FULL_PANEL)
  memory.retain(['A'])
  expect(memory.get('B')).toBeUndefined()
})

it('左手物理按键完整且数字2只选择整格面板', () => {
  expect(['Q', 'W', 'E', 'R', 'T', 'Z', 'X', 'C', 'V'].map(key => toolForKey({ code: `Key${key}`, shiftKey: false })))
    .toEqual(['tubes', 'panels', 'connectors', 'wheels', 'textiles', 'pools', 'slides', 'accessories', 'reinforce'])
  expect(toolForKey({ code: 'KeyC', shiftKey: true })).toBeUndefined()
  expect(NUMBER_TUBES['2']).toBeUndefined()
  expect(FULL_PANEL).toBe('panel_40x40')
})
