import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import StatusTip from './StatusTip'
import { accessoryStrings } from './accessoryStrings'

// 仅隔离界面上下文，真实配件目录、文案和提示生命周期均使用正式实现。
const state = vi.hoisted(() => ({
  mode: 'fitting', fittingKind: 'textile_bridge', fittingPart: 'textile_bridge', panelId: '',
  pasting: false, placingConnector: false, assembly: { active: false }, boxSelect: false,
  selectionCount: 0, selectionTransform: null, installationPreview: null, canFlipAccessory: false,
  selectedPanelFixing: null, toast: null as unknown, readOnly: false,
  engine: () => null,
}))
const layout = vi.hoisted(() => ({ vw: 1200, left: null, right: null, toolbarW: 700 }))
const dock = vi.hoisted(() => ({ pane: null as string | null }))
vi.mock('../store/EngineContext', () => ({ useEngine: () => state }))
vi.mock('./panelLayout', () => ({ NARROW_MAX: 767, usePanelLayout: () => layout, statusTipBox: () => ({ top: 80, left: 200, right: 200 }) }))
vi.mock('./dock', () => ({ useDock: () => dock }))
vi.mock('./useMobileControls', () => ({ useMobileControls: () => layout.vw < 768 }))
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string, args: Record<string, unknown>) => {
  const value = accessoryStrings.zh[key as keyof typeof accessoryStrings.zh] || key
  return value.replace('{size}', String(args?.size || ''))
} }) }))

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.mode = 'fitting'; state.fittingKind = state.fittingPart = 'textile_bridge'
  state.toast = null; state.panelId = ''; dock.pane = null; layout.vw = 1200
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = (menuOpen = false) => act(async () => root.render(createElement(StatusTip, { menuOpen })))
const settle = () => act(async () => vi.advanceTimersByTime(300))

it('选择彩虹桥后持续显示尺寸与拼接提示，切换配件立即更新', async () => {
  await render()
  expect(host.querySelector('[role=status]')?.textContent).toContain('40×80')
  expect(host.textContent).toContain('短管拼接')
  await act(async () => vi.advanceTimersByTime(10000))
  expect(host.textContent).toContain('40×80')
  state.fittingKind = state.fittingPart = 'swing'; await render()
  expect(host.textContent).toContain('摆动空间')
  expect(host.textContent).not.toContain('40×80')
})

it('菜单与反馈显示时隐藏安装提示，关闭后恢复', async () => {
  await render(true); await settle(); expect(host.querySelector('[role=status]')).toBeNull()
  await render(); expect(host.textContent).toContain('40×80')
  state.toast = { message: '安装完成' }; await render(); await settle()
  expect(host.querySelector('[role=status]')).toBeNull()
  state.toast = null; await render(); expect(host.textContent).toContain('40×80')
})

it('面板说明代入实际尺寸，退出安装工具后移除配件说明', async () => {
  state.mode = 'panel'; state.panelId = 'panel_40x20'; await render()
  expect(host.textContent).toContain('40×20')
  state.mode = 'select'; await render()
  expect(host.textContent).not.toContain('40×20')
})

it('手机提示完整换行，打开侧栏时避让', async () => {
  layout.vw = 390; await render()
  expect(host.querySelector('[role=status]')?.className).toContain('whitespace-normal')
  expect(host.textContent).toContain('短管拼接')
  dock.pane = 'parts'; await render(); expect(host.querySelector('[role=status]')).toBeNull()
  dock.pane = null; await render(); expect(host.textContent).toContain('40×80')
})

it.each([
  ['tube-cap2', '管端'], ['open-connector2', '空插口'], ['textil2', '平行直管'],
])('原目录配件 %s 也显示对应安装提示', async (kind, expected) => {
  state.fittingKind = kind; state.fittingPart = ''
  await render(); expect(host.textContent).toContain(expected)
  await act(async () => vi.advanceTimersByTime(10000))
  expect(host.textContent).toContain(expected)
})
