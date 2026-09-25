// 房间边界的几何：画出来的点整理成约定里的 room（见 api.ts 的 Room）。
// 平面图上 x 向右、z 向下，单位厘米；存的时候转成顺时针，平移到外框左上角。

import type { Opening, Room } from './api'

export type Pt = [number, number]

/** 画点时吸附的网格（厘米）。 */
export const ROOM_SNAP = 5

export function snap(v: number, step = ROOM_SNAP) {
  return Math.round(v / step) * step
}

/** 鞋带公式的有向面积；x 向右、z 向下时，顺时针为正。 */
export function signedArea(pts: Pt[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    s += x1 * z2 - x2 * z1
  }
  return s / 2
}

export function edgeLength(pts: Pt[], i: number) {
  const [x1, z1] = pts[i]
  const [x2, z2] = pts[(i + 1) % pts.length]
  return Math.hypot(x2 - x1, z2 - z1)
}

/** 边上从起点量 t 厘米的那一点。 */
export function pointOnEdge(pts: Pt[], i: number, t: number): Pt {
  const [x1, z1] = pts[i]
  const [x2, z2] = pts[(i + 1) % pts.length]
  const L = Math.hypot(x2 - x1, z2 - z1) || 1
  return [x1 + (x2 - x1) * t / L, z1 + (z2 - z1) * t / L]
}

/** 离 p 最近的边：边号、沿边距离、垂直距离。 */
export function nearestEdge(pts: Pt[], p: Pt) {
  let best = { edge: -1, t: 0, dist: Infinity }
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    const dx = x2 - x1, dz = z2 - z1
    const L2 = dx * dx + dz * dz
    if (!L2) continue
    const u = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - z1) * dz) / L2))
    const qx = x1 + dx * u, qz = z1 + dz * u
    const dist = Math.hypot(p[0] - qx, p[1] - qz)
    if (dist < best.dist) best = { edge: i, t: u * Math.sqrt(L2), dist }
  }
  return best
}

/**
 * 画好的轮廓（场景坐标）和门窗整理成约定的 room：顺时针，平移到外框左上角为原点，
 * w、d 取外框。点少于 3 个时只有宽深高。
 */
export function roomFromDrawing(pts: Pt[], openings: Opening[], h: number, fallback: { w: number; d: number }): Room {
  if (pts.length < 3) return { w: fallback.w, d: fallback.d, h }
  let outline = pts.map(([x, z]) => [x, z] as Pt)
  let ops = openings.map(o => ({ ...o }))
  if (signedArea(outline) < 0) {
    // 反过来走：点倒序，第 i 条边变成倒序后的第 n-2-i 条（模 n），沿边距离从另一头量
    const n = outline.length
    outline = outline.slice().reverse()
    ops = ops.map(o => {
      const edge = ((n - 2 - o.edge) % n + n) % n
      const L = edgeLength(outline, edge)
      return { ...o, edge, from: L - o.to, to: L - o.from }
    })
  }
  const minX = Math.min(...outline.map(p => p[0]))
  const minZ = Math.min(...outline.map(p => p[1]))
  outline = outline.map(([x, z]) => [Math.round(x - minX), Math.round(z - minZ)] as Pt)
  const w = Math.max(...outline.map(p => p[0]))
  const d = Math.max(...outline.map(p => p[1]))
  return {
    w, d, h,
    outline,
    openings: ops.map(o => ({ kind: o.kind, edge: o.edge, from: Math.round(Math.min(o.from, o.to)), to: Math.round(Math.max(o.from, o.to)) })),
  }
}
