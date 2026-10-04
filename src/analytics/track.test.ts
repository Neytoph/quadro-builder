import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const successNames = ['builder.design.save', 'builder.design.saveAs', 'builder.export.manual.done']
const siteNames = ['builder.wechat.open', 'builder.wechat.download', 'builder.wechat.prompt']
const sources = ['home', 'chat', 'builder-help', 'builder-save', 'builder-manual']

// 隔离统计出口，不发送真实请求；业务成功位置由 EngineContext 的调用方确认。
const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }))
const spyWindow = () => vi.spyOn(window, 'addEventListener')
const spyDocument = () => vi.spyOn(document, 'addEventListener')
let windowListeners: ReturnType<typeof spyWindow>
let documentListeners: ReturnType<typeof spyDocument>

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('VITE_ANALYTICS_URL', '')
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  windowListeners = vi.spyOn(window, 'addEventListener')
  documentListeners = vi.spyOn(document, 'addEventListener')
})

afterEach(() => {
  for (const [name, listener, options] of windowListeners.mock.calls) {
    window.removeEventListener(name, listener, options)
  }
  for (const [name, listener, options] of documentListeners.mock.calls) {
    document.removeEventListener(name, listener, options)
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function send(detail: unknown): void {
  window.dispatchEvent(new CustomEvent('quadro-builder:track', { detail }))
}

describe('托管页面行动和统计桥接', () => {
  it('未配置统计时仍通知三种成功动作，仅包含名称', async () => {
    const { track, startAnalytics } = await import('./track')
    const actions: unknown[] = []
    window.addEventListener('quadro-builder:action', event => {
      actions.push((event as CustomEvent<unknown>).detail)
    })
    startAnalytics()
    for (const name of successNames) track(name, { privateContent: '不应跨越桥接' })
    track('builder.export.manual.start')
    track('builder.design.duplicate')
    send({ name: 'builder.wechat.open', props: { source: 'builder-help' } })
    await vi.advanceTimersByTimeAsync(20000)
    expect(actions).toEqual(successNames.map(name => ({ name })))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('已配置统计时成功事件仍进入原有批处理', async () => {
    vi.stubEnv('VITE_ANALYTICS_URL', '/events')
    const { track } = await import('./track')
    const actions = vi.fn()
    window.addEventListener('quadro-builder:action', actions)
    track('builder.design.save', { named: true })
    expect(actions).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4000)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/events')
    expect(JSON.parse(String(init.body)).events).toEqual([
      { name: 'builder.design.save', props: { named: true, visit: expect.any(String) } },
    ])
  })

  it('只接受事件和来源白名单，额外输入不进入统计，也不回发动作', async () => {
    vi.stubEnv('VITE_ANALYTICS_URL', '/events')
    const { startAnalytics } = await import('./track')
    const actions = vi.fn()
    window.addEventListener('quadro-builder:action', actions)
    startAnalytics()
    const expected = []
    for (const name of siteNames) {
      for (const source of sources) {
        send({ name, props: { source, text: '用户输入', docId: '私人文档' }, user: '私人标识' })
        expected.push({ name, props: { source, visit: expect.any(String) } })
      }
    }
    window.dispatchEvent(new Event('quadro-builder:track'))
    for (const detail of [
      null, [], {}, { name: 1 }, { name: 'builder.design.save', props: { source: 'home' } },
      { name: 'builder.wechat.other', props: { source: 'home' } },
      { name: 'builder.wechat.open' }, { name: 'builder.wechat.open', props: null },
      { name: 'builder.wechat.open', props: [] },
      { name: 'builder.wechat.open', props: { source: 1 } },
      { name: 'builder.wechat.open', props: { source: '用户输入' } },
      { name: 'builder.wechat.open', props: { source: 'HOME' } },
    ]) send(detail)
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/events')
    expect(JSON.parse(String(init.body)).events).toEqual(expected)
    expect(actions).not.toHaveBeenCalled()
  })

  it('重复初始化不会重复记录托管页面事件', async () => {
    vi.stubEnv('VITE_ANALYTICS_URL', '/events')
    const { startAnalytics } = await import('./track')
    startAnalytics()
    startAnalytics()
    send({ name: 'builder.wechat.open', props: { source: 'builder-help' } })
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).events).toHaveLength(1)
  })
})
