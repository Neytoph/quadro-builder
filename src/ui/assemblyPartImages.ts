import { colorHex } from '../engine/catalog.js'
import { partImageSrc } from './partImages'

type Item = { id: string; kind: string; color?: string | null }
const images = new Map<string, Promise<string>>()

/** 对应真实目录照片的着色面保留纹理、明暗、孔口和透明边缘。 */
export function recolorAssemblyPixels(pixels: Uint8ClampedArray, target: [number, number, number], kind: string) {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!pixels[offset + 3]) continue
    const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    const high = Math.max(...rgb), low = Math.min(...rgb)
    const coloredSurface = kind === 'tubes' ? rgb[0] > rgb[1] * 1.15 && rgb[0] > rgb[2] * 1.15 : rgb[2] > rgb[0] * 1.15
    if (!coloredSurface || high - low < 20) continue
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(low + (high - low) * target[channel] / 255)
  }
  return pixels
}

export function assemblyPartImageKey(item: Item) {
  return `${item.id}:${item.kind}:${item.color && ['tubes', 'panels'].includes(item.kind) ? colorHex(item.color) : 'catalog'}`
}

export function loadAssemblyPartImage(item: Item): Promise<string> {
  const key = assemblyPartImageKey(item)
  if (images.has(key)) return images.get(key)!
  const source = partImageSrc(item.id)
  if (!source) return Promise.reject(new Error(`Missing catalog photograph: ${item.id}`))
  const result = new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error(`Catalog photograph could not load: ${item.id}`))
    image.onload = () => {
      if (!item.color || !['tubes', 'panels'].includes(item.kind)) { resolve(source); return }
      let canvas: HTMLCanvasElement | null = null
      try {
        canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Assembly photograph canvas is unavailable')
        context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, canvas.width, canvas.height)
        const hex = colorHex(item.color).replace('#', '')
        const color = [0, 2, 4].map(start => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number]
        if (!color.every(Number.isFinite)) throw new Error(`Invalid assembly photograph colour: ${item.color}`)
        recolorAssemblyPixels(data.data, color, item.kind)
        context.putImageData(data, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (error) { reject(error) }
      finally { if (canvas) canvas.width = canvas.height = 0 }
    }
    image.src = source
  })
  images.set(key, result)
  result.catch(() => images.delete(key))
  return result
}
