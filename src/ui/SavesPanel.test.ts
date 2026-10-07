import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { docs, storage } from '../engine-api'
import SavesPanel from './SavesPanel'

// 页面交接契约夹具：门禁结果由测试控制；真实Worker/服务端尺寸由QA验收。
const api = vi.hoisted(() => ({
  listDocs: vi.fn(), captureThumb: vi.fn(), pushDoc: vi.fn(), notify: vi.fn(),
}))
vi.mock('../store/EngineContext', () => ({ useEngine: () => api }))
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key, lang: 'de' }) }))
vi.mock('./dock', () => ({ useDock: () => ({ setPane: vi.fn() }) }))
vi.mock('../sync/bootstrap', () => ({ syncConfigured: () => true, syncStarted: () => true, onSyncStart: () => () => {} }))
vi.mock('../publish', () => ({ publishEnabled: () => true, publishStates: async () => new Map(), publishPage: (_lang: string, id: string) => `/publish/de?model=${id}` }))
vi.mock('../analytics/track', () => ({ track: vi.fn() }))
let root: Root
let host: HTMLDivElement
let nav: { href: string }
let serial = 0
const data = { nodes: [{ id: 1, x: 0, y: 0, z: 0 }], tubes: [] }
function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(async () => {
  vi.clearAllMocks()
  storage.setAccountScope(`publish-panel-${++serial}`)
  await docs.putRemoteDoc({ id: 'A', name: 'A', data, rev: 1, createdAt: 1, updatedAt: 1 })
  api.listDocs.mockResolvedValue([{ id: 'A', name: 'A', updatedAt: 1, local: false }])
  api.captureThumb.mockResolvedValue('cover')
  nav = { href: '/builder' }
  vi.stubGlobal('location', nav)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(SavesPanel)) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); storage.setAccountScope(null) })
function button() { return host.querySelector<HTMLButtonElement>('[data-ui="saved-publish"]')! }

it('发布明确要求同内容统计门禁；等待时留页且重复点击不重新上传，成功才导航', async () => {
  const gate = held<boolean>()
  api.pushDoc.mockReturnValue(gate.promise)
  await act(async () => { button().click() })
  await vi.waitFor(() => expect(api.pushDoc).toHaveBeenCalledTimes(1))
  const covered = await docs.getDoc('A')
  expect(api.pushDoc).toHaveBeenCalledWith('A', { requireStats: true, expectedData: data, expectedUpdatedAt: covered!.updatedAt, expectedSaveId: covered!.saveId })
  expect(nav.href).toBe('/builder')
  await act(async () => { button().click() })
  expect(api.captureThumb).toHaveBeenCalledTimes(1)
  await act(async () => { gate.resolve(true) })
  expect(nav.href).toBe('/publish/de?model=A')
})

it('统计门禁失败/超时留Builder并提示，按钮释放可再次重试', async () => {
  api.pushDoc.mockResolvedValue(false)
  await act(async () => { button().click() })
  await vi.waitFor(() => expect(api.notify).toHaveBeenCalledWith('saves.publishNotYet', 'warn'))
  expect(nav.href).toBe('/builder')
  await act(async () => {})
  expect(button().disabled).toBe(false)
})

it('截图期间同saveId改名/封面版本变化，不挂旧封面、不导航', async () => {
  const capture = held<string>()
  api.captureThumb.mockReturnValue(capture.promise)
  await act(async () => { button().click() })
  await vi.waitFor(() => expect(api.captureThumb).toHaveBeenCalled())
  await docs.renameDoc('A', 'new name')
  await act(async () => { capture.resolve('old-cover') })
  await vi.waitFor(() => expect(api.notify).toHaveBeenCalledWith('saves.publishNotYet', 'warn'))
  expect((await docs.getDoc('A'))!.cover).toBeUndefined()
  expect(api.pushDoc).not.toHaveBeenCalled()
  expect(nav.href).toBe('/builder')
})

it('截图期间或统计门禁结束前换账号都不能导航', async () => {
  const gate = held<boolean>()
  api.pushDoc.mockReturnValue(gate.promise)
  await act(async () => { button().click() })
  await vi.waitFor(() => expect(api.pushDoc).toHaveBeenCalled())
  storage.setAccountScope('another-account')
  await act(async () => { gate.resolve(true) })
  expect(nav.href).toBe('/builder')
  expect(api.notify).toHaveBeenCalledWith('saves.publishNotYet', 'warn')
})
