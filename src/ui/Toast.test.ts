import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Toast from './Toast'

// 仅验证反馈组件的生命周期；保存成功由真实本地服务另行验收。
const state = vi.hoisted(() => ({ toast: null as { message: string; kind: 'saved' | 'warn' | 'ok'; id?: number } | null, dismissToast: vi.fn() }))
vi.mock('../store/EngineContext', () => ({ useEngine: () => state }))
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.dismissToast.mockReset(); state.toast = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
const render = () => act(async () => root.render(createElement(Toast)))

it('保存成功持续显示并支持主动关闭，提示不会抢走编辑焦点', async () => {
  const editor = document.createElement('button'); document.body.append(editor); editor.focus()
  state.toast = { kind: 'saved', message: '真实名称' }; await render()
  await act(async () => vi.advanceTimersByTime(10000))
  expect(state.dismissToast).not.toHaveBeenCalled()
  expect(host.querySelector('[role=status]')?.textContent).toContain('真实名称')
  expect(document.activeElement).toBe(editor)
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(state.dismissToast).toHaveBeenCalledOnce(); editor.remove()
})

it('处理中提示的旧计时器不会关闭随后到达的成功提示', async () => {
  state.toast = { kind: 'ok', message: '正在同步' }; await render()
  await act(async () => vi.advanceTimersByTime(2000))
  state.toast = { kind: 'saved', message: '已保存' }; await render()
  await act(async () => vi.advanceTimersByTime(10000))
  expect(state.dismissToast).not.toHaveBeenCalled()
  expect(host.querySelector('[data-tone=saved]')).not.toBeNull()
})

it('后续错误反馈替换成功卡片并使用原有停留时间', async () => {
  state.toast = { kind: 'saved', message: '上一次保存' }; await render()
  state.toast = { kind: 'warn', message: '下一次保存失败' }; await render()
  expect(host.querySelector('[data-tone=saved]')).toBeNull()
  expect(host.textContent).toContain('下一次保存失败')
  await act(async () => vi.advanceTimersByTime(6000))
  expect(state.dismissToast).toHaveBeenCalledOnce()
})

it('连续保存同名造型重新显示反馈', async () => {
  state.toast = { kind: 'saved', message: '同一造型', id: 1 }; await render()
  const first = host.querySelector('[data-tone=saved]')
  state.toast = { kind: 'saved', message: '同一造型', id: 2 }; await render()
  expect(host.querySelector('[data-tone=saved]')).not.toBe(first)
})
