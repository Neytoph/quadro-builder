import type { BomView, BomRow, InvRow } from '../store/EngineContext'
import { colorHex } from '../engine-api'
import { colorLabel, labelOf } from '../names'
import { formatCatalogPrice } from '../money'
import { drawQr, type Stamp } from '../sharePage'

type Lang = 'zh' | 'en' | 'de'
type T = (key: string, vars?: Record<string, string | number>) => string

export interface BomSection {
  title: string
  rows: BomRow[]
}

/** 零件清单的九个分区，顺序和面板上一致。 */
export function bomSections(bom: BomView, t: T): BomSection[] {
  return [
    { title: t('bom.tubes'), rows: bom.tubes },
    { title: t('bom.connectors'), rows: bom.connectors },
    { title: t('bom.panels'), rows: bom.panels },
    { title: t('bom.slides'), rows: bom.slides },
    { title: t('bom.wheels'), rows: bom.wheels },
    { title: t('bom.textiles'), rows: bom.textiles },
    { title: t('bom.fittings'), rows: bom.fittings },
    { title: t('bom.reinforcements'), rows: bom.reinforcements },
    { title: t('bom.screws'), rows: bom.screws },
  ].filter(s => s.rows.length)
}

function rowName(r: BomRow) {
  let label = labelOf(r.id || '', r.name)
  if (r.kind === 'textiles' && r.w && r.h) {
    const size = `${r.w}×${r.h}`
    if (!label.includes('×')) label = label ? `${label} ${size} cm` : `${size} cm`
  }
  return label
}

function colorWord(color?: string | null) {
  if (!color) return ''
  return color.startsWith('#') ? color : colorLabel(color)
}

function csvCell(v: string | number) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface BomExportInput {
  bom: BomView
  name: string
  sizeCm: [number, number, number] | null
  /** 填了库存才有：按零件 id 给出拥有和还缺 */
  invRows: InvRow[]
  lang: Lang
  t: T
  /** 方案页的网址和二维码（部署接了方案页才有，见 src/sharePage.ts） */
  stamp?: Stamp | null
}

/** 料表 CSV。带 BOM 头，Excel 和 Numbers 双击就能开。 */
export function bomToCsv({ bom, name, sizeCm, invRows, lang, t, stamp }: BomExportInput): string {
  const stock = new Map<string, InvRow>()
  for (const r of invRows) if (r.key) stock.set(r.key, r)
  const withStock = stock.size > 0

  const head = [t('bomx.col.section'), t('bomx.col.part'), t('bomx.col.color'), t('bomx.col.count')]
  if (withStock) head.push(t('bomx.col.owned'), t('bomx.col.short'))
  head.push(t('bomx.col.subtotal'))

  const lines = [head.map(csvCell).join(',')]
  // 库存不分颜色，料表按颜色分行：同一个零件只在第一行给拥有和还缺
  const counted = new Set<string>()
  for (const sec of bomSections(bom, t)) {
    for (const r of sec.rows) {
      const cells: (string | number)[] = [sec.title, rowName(r), colorWord(r.color), r.count]
      if (withStock) {
        const s = r.id && !counted.has(r.id) ? stock.get(r.id) : null
        if (r.id) counted.add(r.id)
        cells.push(s ? s.owned : '', s && s.need > s.owned ? s.need - s.owned : '')
      }
      cells.push(r.subtotal ? formatCatalogPrice(r.subtotal, lang) : '')
      lines.push(cells.map(csvCell).join(','))
    }
  }
  lines.push('')
  lines.push([t('bomx.total'), '', '', bom.totals.tubes + bom.totals.connectors + bom.totals.panels + bom.totals.other,
    ...(withStock ? ['', ''] : []), formatCatalogPrice(bom.totals.price, lang)].map(csvCell).join(','))
  if (sizeCm) lines.push([t('side.size'), `${sizeCm[0]} × ${sizeCm[1]} × ${sizeCm[2]} cm`].map(csvCell).join(','))
  lines.push([t('bomx.design'), name].map(csvCell).join(','))
  lines.push([t('bomx.date'), new Date().toLocaleDateString()].map(csvCell).join(','))
  if (stamp) lines.push([t('stamp.page'), stamp.url].map(csvCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

const W = 900
const PAD = 36
const HEAD_H = 132
const THUMB_W = 168
const LINE = 30
const SEC_GAP = 18
const SEC_HEAD = 26
const FOOT_H = 64

function layout(sections: BomSection[]) {
  // 一列排得下就一列，排不下分两列
  const unit = (s: BomSection) => SEC_HEAD + s.rows.length * LINE + SEC_GAP
  const total = sections.reduce((a, s) => a + unit(s), 0)
  if (total <= 760) return { cols: 1 as const, height: total }
  let half = 0
  let cut = 0
  for (let i = 0; i < sections.length; i++) {
    if (half + unit(sections[i]) > total / 2 && i > 0) { cut = i; break }
    half += unit(sections[i])
    cut = i + 1
  }
  const left = sections.slice(0, cut).reduce((a, s) => a + unit(s), 0)
  const right = sections.slice(cut).reduce((a, s) => a + unit(s), 0)
  return { cols: 2 as const, cut, height: Math.max(left, right) }
}

/** 料表图片：白底 PNG，发群里直接能看。thumb 是模型缩略图的 dataURL，可空。 */
export function bomToPngDataUrl(input: BomExportInput, thumb: HTMLImageElement | null): string | null {
  const { bom, name, sizeCm, lang, t, stamp } = input
  const sections = bomSections(bom, t)
  if (!sections.length) return null
  const plan = layout(sections)
  const height = HEAD_H + plan.height + FOOT_H
  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  const font = (size: number, weight = '400') =>
    `${weight} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif`

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, height)

  // 抬头：缩略图、设计名、尺寸、合计
  let textLeft = PAD
  if (thumb) {
    const h = HEAD_H - 2 * PAD + 24
    const w = THUMB_W
    ctx.save()
    ctx.fillStyle = '#f4f1ec'
    ctx.fillRect(PAD, PAD - 8, w, h)
    const scale = Math.min(w / thumb.width, h / thumb.height)
    const dw = thumb.width * scale, dh = thumb.height * scale
    ctx.drawImage(thumb, PAD + (w - dw) / 2, PAD - 8 + (h - dh) / 2, dw, dh)
    ctx.restore()
    textLeft = PAD + w + 24
  }
  // 右上角：方案页的二维码，扫码的人能转动看 3D、一步一步看手册
  let textRight = W - PAD
  if (stamp) {
    const qr = HEAD_H - PAD + 4
    drawQr(ctx, stamp.url, W - PAD - qr, PAD - 16, qr)
    textRight = W - PAD - qr - 20
  }
  const textW = textRight - textLeft
  ctx.fillStyle = '#111827'
  ctx.font = font(30, '600')
  ctx.fillText(name, textLeft, PAD + 22, textW)
  ctx.fillStyle = '#6b7280'
  ctx.font = font(15)
  const sub: string[] = [t('bomx.title')]
  if (sizeCm) sub.push(`${sizeCm[0]} × ${sizeCm[1]} × ${sizeCm[2]} cm`)
  ctx.fillText(sub.join('  ·  '), textLeft, PAD + 50, textW)
  const parts = bom.totals.tubes + bom.totals.connectors + bom.totals.panels + bom.totals.other
  ctx.fillText(`${t('bomx.total')} ${parts}  ·  ${t('side.price')} ${formatCatalogPrice(bom.totals.price, lang)}`, textLeft, PAD + 74, textW)
  if (stamp) ctx.fillText(t('stamp.hint'), textLeft, PAD + 98, textW)

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, HEAD_H - 10)
  ctx.lineTo(W - PAD, HEAD_H - 10)
  ctx.stroke()

  const colW = plan.cols === 2 ? (W - 2 * PAD - 40) / 2 : W - 2 * PAD
  const drawSections = (list: BomSection[], x: number) => {
    let y = HEAD_H + 16
    for (const sec of list) {
      ctx.fillStyle = '#9ca3af'
      ctx.font = font(13, '600')
      ctx.fillText(sec.title, x, y)
      y += SEC_HEAD
      for (const r of sec.rows) {
        ctx.fillStyle = '#111827'
        ctx.font = font(15)
        let tx = x
        if (r.color) {
          ctx.beginPath()
          ctx.fillStyle = String(colorHex(r.color))
          ctx.arc(x + 6, y - 5, 6, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#d1d5db'
          ctx.stroke()
          tx = x + 20
          ctx.fillStyle = '#111827'
        }
        const tint = colorWord(r.color)
        const label = tint ? `${rowName(r)} · ${tint}` : rowName(r)
        const countText = `×${r.count}`
        const countW = ctx.measureText(countText).width
        let shown = label
        while (ctx.measureText(shown).width > colW - (tx - x) - countW - 16 && shown.length > 4) {
          shown = shown.slice(0, -2)
        }
        if (shown !== label) shown += '…'
        ctx.fillText(shown, tx, y)
        ctx.fillStyle = '#374151'
        ctx.fillText(countText, x + colW - countW, y)
        y += LINE
      }
      y += SEC_GAP
    }
  }
  if (plan.cols === 1) drawSections(sections, PAD)
  else {
    drawSections(sections.slice(0, plan.cut), PAD)
    drawSections(sections.slice(plan.cut), PAD + colW + 40)
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = font(13)
  ctx.fillText(`${t('bomx.date')} ${new Date().toLocaleDateString()}`, PAD, height - 26)
  if (stamp) {
    ctx.fillStyle = '#ea580c'
    ctx.font = font(13, '600')
    ctx.fillText(stamp.host, W - PAD - ctx.measureText(stamp.host).width, height - 26)
  }
  return canvas.toDataURL('image/png')
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
