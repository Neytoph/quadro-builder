// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PanelLayoutProvider, usePanelLayout } from './panelLayout'

vi.mock('../entry', () => ({ EDITOR_EMBED: false }))

let host: HTMLDivElement
let root: Root

function Probe() {
  const { left, leftColor, leftKeys, toggleLeftColor } = usePanelLayout()
  return createElement('button', { onClick: toggleLeftColor }, `${leftColor}:${leftKeys}:${left.width}`)
}

async function mount() {
  await act(async () => root.render(createElement(PanelLayoutProvider, null, createElement(Probe))))
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('首次进入默认收起，手动展开后刷新仍保留选择', async () => {
  await mount()
  expect(host.textContent).toBe('false:true:192')
  await act(async () => host.querySelector('button')!.click())
  await act(async () => vi.advanceTimersByTime(160))
  await act(async () => root.unmount())
  root = createRoot(host)
  await mount()
  expect(host.textContent).toBe('true:true:192')
})

it('旧布局迁移时收起颜色，保留面板宽度和快捷键状态', async () => {
  localStorage.setItem('quadro.ui.layout.v3', JSON.stringify({
    left: { width: 240, top: 72, height: 400 },
    right: { width: 368, top: 72, height: 400 },
    leftColor: true,
    leftKeys: false,
  }))
  await mount()
  expect(host.textContent).toBe('false:false:240')
  await act(async () => vi.advanceTimersByTime(160))
  expect(JSON.parse(localStorage.getItem('quadro.ui.layout.v4')!).leftColor).toBe(false)
})
