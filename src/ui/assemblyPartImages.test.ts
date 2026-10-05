import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { loadCatalog } from '../engine/catalog.js'
import { recolorAssemblyPixels, assemblyPartImageKey, loadAssemblyPartImage } from './assemblyPartImages'
beforeAll(loadCatalog)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('真实照片着色面保持透明边缘、明暗差、孔口及中性高光', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 0, 200, 40, 40, 255, 120, 20, 20, 128, 32, 32, 32, 255, 220, 220, 220, 255])
  const output = recolorAssemblyPixels(pixels, [40, 80, 220], 'tubes')
  expect([...output.slice(0, 4)]).toEqual([0, 0, 0, 0])
  expect(output[6]).toBeGreaterThan(output[4])
  expect(output[6]).toBeGreaterThan(output[10])
  expect(output[11]).toBe(128)
  expect([...output.slice(12)]).toEqual([32, 32, 32, 255, 220, 220, 220, 255])
})

it('同目录图不同实际颜色的缓存key不同，其他配件保持原始目录图', () => {
  expect(assemblyPartImageKey({ id: 'T35', kind: 'tubes', color: 'red' })).not.toBe(assemblyPartImageKey({ id: 'T35', kind: 'tubes', color: 'blue' }))
  expect(assemblyPartImageKey({ id: '3way', kind: 'connectors', color: 'red' })).toBe(assemblyPartImageKey({ id: '3way', kind: 'connectors', color: 'blue' }))
  const pixels = new Uint8ClampedArray([20, 60, 180, 255, 170, 30, 30, 255])
  recolorAssemblyPixels(pixels, [255, 200, 0], 'panels')
  expect(pixels[0]).toBeGreaterThan(pixels[2])
  expect([...pixels.slice(4)]).toEqual([170, 30, 30, 255])
})

it('照片canvas资源错误明确拒绝且移除失败缓存，下一次请求可以重试', async () => {
  let loads = 0
  vi.stubGlobal('Image', class {
    naturalWidth = 1
    naturalHeight = 1
    onload: (() => void) | null = null
    set src(_value: string) { loads++; queueMicrotask(() => this.onload?.()) }
  })
  const canvasPrototype = HTMLCanvasElement.prototype as unknown as { getContext: (type: string, options?: unknown) => CanvasRenderingContext2D | null }
  const context = vi.spyOn(canvasPrototype, 'getContext').mockReturnValue(null)
  const item = { id: 'T35', kind: 'tubes', color: 'red' }
  await expect(loadAssemblyPartImage(item)).rejects.toThrow('canvas is unavailable')
  context.mockReturnValue({ drawImage() {}, getImageData() { throw new Error('pixel read failed') } } as unknown as CanvasRenderingContext2D)
  await expect(loadAssemblyPartImage(item)).rejects.toThrow('pixel read failed')
  context.mockReturnValue({ drawImage() {}, getImageData() { return { data: new Uint8ClampedArray([200, 40, 40, 255]) } }, putImageData() {} } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,retry')
  await expect(loadAssemblyPartImage(item)).resolves.toBe('data:image/png;base64,retry')
  expect(loads).toBe(3)
})
