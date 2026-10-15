import { beforeAll, expect, it } from 'vitest'
import { accessories, allConnectors, buildableCurvedTubes, buildablePanels, buildableTubes, loadCatalog } from '../engine/catalog.js'
import { installationChoices } from './installationCatalogue'
import { captureTool, ToolMemory, type ToolState } from './toolMemory'
import type { useEngine } from './EngineContext'

beforeAll(async () => { await loadCatalog() })
const state = (changes: Partial<ToolState> = {}): ToolState => ({ mode: 'select', panelId: 'panel_40x40', tubeId: 'T35', slideKind: 'slide-new2',
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
  expect(memory.get('A')?.partId).toBe('panel_40x40')
  memory.retain(['A'])
  expect(memory.get('B')).toBeUndefined()
})
