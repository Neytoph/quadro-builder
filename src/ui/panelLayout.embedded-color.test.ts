// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PanelLayoutProvider, usePanelLayout } from './panelLayout'

vi.mock('../entry', () => ({ EDITOR_EMBED: true }))

let host: HTMLDivElement
let root: Root

function Probe() {
  const { left, leftColor, leftKeys } = usePanelLayout()
  return createElement('span', null, `${leftColor}:${leftKeys}:${left.width}`)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('嵌入编辑器首次进入时，颜色和快捷键都收起', async () => {
  await act(async () => root.render(createElement(PanelLayoutProvider, null, createElement(Probe))))
  expect(host.textContent).toBe('false:false:192')
})

it('嵌入编辑器迁移旧布局时保留宽度和快捷键', async () => {
  localStorage.setItem('quadro.ui.model-editor.layout.v1', JSON.stringify({
    left: { width: 240, top: 72, height: 400 },
    right: { width: 368, top: 72, height: 400 },
    leftColor: true,
    leftKeys: true,
  }))
  await act(async () => root.render(createElement(PanelLayoutProvider, null, createElement(Probe))))
  expect(host.textContent).toBe('false:true:240')
})
