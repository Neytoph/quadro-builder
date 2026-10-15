import { drawQr, type Stamp } from '../sharePage'
import { loadImage } from './bomExport'

type T = (key: string, vars?: Record<string, string | number>) => string

const W = 1600
const BAND = 220
const PAD = 40
const QR = 176

function font(size: number, weight = '400') {
  return `${weight} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif`
}

/**
 * 分享图：3D 画面在上，底下一条印着这一座的名字、方案页网址和二维码。
 * 图被转到群里、朋友圈里，看到的人扫一下就能打开方案页。
 */
export async function shareImageDataUrl(shot: string, name: string, stamp: Stamp, t: T): Promise<string> {
  const img = await loadImage(shot)
  if (!img) throw new Error('snapshot')
  const h = Math.round(img.height * (W / img.width))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = h + BAND
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img, 0, 0, W, h)

  ctx.fillStyle = '#fff7f0'
  ctx.fillRect(0, h, W, BAND)
  ctx.fillStyle = '#f1dfcd'
  ctx.fillRect(0, h, W, 2)

  const qrX = W - PAD - QR
  drawQr(ctx, stamp.url, qrX, h + (BAND - QR) / 2, QR)

  const textW = qrX - PAD * 2
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#1f2430'
  ctx.font = font(52, '700')
  ctx.fillText(name, PAD, h + 84, textW)
  ctx.fillStyle = '#5c6570'
  ctx.font = font(30)
  ctx.fillText(t('stamp.hint'), PAD, h + 134, textW)
  ctx.fillStyle = '#ea580c'
  ctx.font = font(32, '700')
  ctx.fillText(stamp.host, PAD, h + 180, textW)
  return canvas.toDataURL('image/png')
}
