import { describe, expect, it } from 'vitest'
import { edgeLength, nearestEdge, pointOnEdge, roomFromDrawing, signedArea, type Pt } from './room'

// L 形房间，场景坐标，顺时针（x 右、z 下）
const L: Pt[] = [[-160, -130], [160, -130], [160, 130], [-100, 130], [-100, 92], [-160, 92]]

describe('房间边界', () => {
  it('顺时针的轮廓整理到外框左上角，宽深取外框', () => {
    expect(signedArea(L)).toBeGreaterThan(0)
    const room = roomFromDrawing(L, [{ kind: 'window', edge: 0, from: 100, to: 156 }], 265, { w: 0, d: 0 })
    expect(room.w).toBe(320)
    expect(room.d).toBe(260)
    expect(room.outline![0]).toEqual([0, 0])
    expect(room.outline![2]).toEqual([320, 260])
    expect(room.openings).toEqual([{ kind: 'window', edge: 0, from: 100, to: 156 }])
  })

  it('逆时针画的倒过来，门窗跟着换到同一条边、同一个位置', () => {
    const ccw = L.slice().reverse()
    // 原来第 0 条边（点 0 到点 1）在倒序里是第 n-2 条边，方向相反
    const n = ccw.length
    const len = edgeLength(ccw, n - 2)
    const room = roomFromDrawing(ccw, [{ kind: 'door', edge: n - 2, from: len - 156, to: len - 100 }], 265, { w: 0, d: 0 })
    expect(signedArea(room.outline!)).toBeGreaterThan(0)
    const o = room.openings![0]
    const a = pointOnEdge(room.outline!, o.edge, o.from)
    const b = pointOnEdge(room.outline!, o.edge, o.to)
    expect(a).toEqual([100, 0])
    expect(b).toEqual([156, 0])
  })

  it('存下的轮廓拿回来接着画，再整理一遍结果不变', () => {
    const room = roomFromDrawing(L, [{ kind: 'door', edge: 4, from: 0, to: 38 }], 250, { w: 0, d: 0 })
    expect(roomFromDrawing(room.outline!, room.openings!, 250, { w: 0, d: 0 })).toEqual(room)
  })

  it('没画轮廓只有宽深高', () => {
    expect(roomFromDrawing([], [], 240, { w: 300, d: 400 })).toEqual({ w: 300, d: 400, h: 240 })
  })

  it('找最近的边', () => {
    const e = nearestEdge(L, [0, -120])
    expect(e.edge).toBe(0)
    expect(e.t).toBeCloseTo(160)
    expect(e.dist).toBeCloseTo(10)
  })
})
