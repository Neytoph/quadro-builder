import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const realMesh = (file: string) => new Response(readFileSync(`public/data/models/${file}`, 'utf8'))

it('真实网格数据契约：fine仍在等待时已经交付完整coarse及准确厘米坐标', async () => {
  let release!: () => void
  const fineGate = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('-fine.json')) { await fineGate; return realMesh('connectors-fine.json') }
    return realMesh('connectors.json')
  }))
  const { loadConnectorMeshes } = await import('./meshes.js')
  let coarse: Record<string, { pos: Float32Array }> | null = null
  const loading = loadConnectorMeshes(true, { onCoarse: (value: typeof coarse) => { coarse = value } })
  await vi.waitFor(() => expect(coarse).not.toBeNull())
  const raw = JSON.parse(readFileSync('public/data/models/connectors.json', 'utf8'))
  expect(Object.keys(coarse!)).toEqual(Object.keys(raw))
  const key = Object.keys(raw)[0]
  expect(coarse![key].pos[0]).toBeCloseTo(raw[key].pos[0] / 100)
  release()
  expect(await loading).not.toBe(coarse)
})

it('网格请求契约夹具：超时或消费者取消后可以再次读取，不永久缓存null', async () => {
  vi.useFakeTimers()
  let requests = 0
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    requests++
    if (requests > 1) return Promise.resolve(realMesh('tubes.json'))
    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
  }))
  const { loadTubeMeshes } = await import('./meshes.js')
  const first = loadTubeMeshes(false)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(await first).toBeNull()
  expect(await loadTubeMeshes(false)).not.toBeNull()
  expect(requests).toBe(2)
})
