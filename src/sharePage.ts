// 导出文件上的方案页网址和二维码。
//
// 托管版构建时设了 VITE_SHARE_API（例如 '/quadro/shares'）：导出安装手册、料表、
// 分享图之前，先把这一座存成一个方案页，文件的每一页角上印它的网址和二维码，
// 拿到纸的人扫一下就能转动看 3D、一步一步看手册。「复制分享链接」也走它：
// 复制的是这个方案页的地址，一条短链接，不再把整座造型编进链接里。
// 开源本地版不设，导出的文件不带网址，分享链接照旧是编进整座造型的长链接。
//
// 后端契约：
//
//	POST {VITE_SHARE_API}
//	  ← {key, title, model, parts, size:[宽,深,高], steps, cover: dataURL, stats}
//	  → {slug, url}   url 是方案页的绝对地址
//
// stats 是这一座的量（src/designStats.ts），后端可以拿它当客观量。
//
// key 是这一座在 Builder 里的标识（存过档用存档 id，没存过用标签页 id），
// 同一座再导出一次，后端更新同一个方案页，二维码不变。

import QRCode from 'qrcode'
import type { DesignStats } from './designStats'

/** 导出物的来源标记，写在二维码链接和分享链接的 ?from= 上。 */
export type ExportKind = 'manual' | 'bom' | 'shareimg' | 'link'

export interface Stamp {
  /** 二维码里的完整链接，带 ?from= */
  url: string
  /** 印在二维码旁边给人看的网址 */
  host: string
}

export interface SharePageInput {
  key: string
  title: string
  model: unknown
  parts: Record<string, Record<string, number>>
  size: [number, number, number]
  steps: number
  cover: string
  stats: DesignStats
}

export function sharePagesEnabled(): boolean {
  return Boolean(import.meta.env.VITE_SHARE_API)
}

/** 存成方案页，返回方案页的地址。存不上就抛错，导出跟着停下：印一个打不开的二维码没有意义。 */
export async function publishSharePage(input: SharePageInput): Promise<string> {
  const res = await fetch(import.meta.env.VITE_SHARE_API as string, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`share page → ${res.status}`)
  const body = (await res.json()) as { url?: string }
  if (!body.url) throw new Error('share page: no url')
  return body.url
}

export function stampFor(pageUrl: string, kind: ExportKind): Stamp {
  const u = new URL(pageUrl)
  u.searchParams.set('from', kind)
  return { url: u.toString(), host: u.host }
}

/**
 * 在 2D 画布上画二维码：(x, y) 起、边长 size 的正方形，四周留两格白边。
 * 每一格取整数像素，扫码软件认得更稳。
 */
export function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const quiet = 2
  const cell = Math.max(1, Math.floor(size / (n + quiet * 2)))
  const used = cell * (n + quiet * 2)
  const ox = Math.round(x + (size - used) / 2)
  const oy = Math.round(y + (size - used) / 2)
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(size), Math.round(size))
  ctx.fillStyle = '#1f2430'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) ctx.fillRect(ox + (c + quiet) * cell, oy + (r + quiet) * cell, cell, cell)
    }
  }
  ctx.restore()
}
