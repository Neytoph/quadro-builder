import { beforeAll, describe, expect, it } from 'vitest'
import { drawManualArrows, layoutOperationCallouts, projectedOperationArrowHead, projectOperationMarks } from './assemblyManual.js'
import { BuildModel } from './model.js'
import { loadCatalog } from './catalog.js'

beforeAll(async () => { await loadCatalog() })

type Box = { x: number; y: number; boxWidth: number; boxHeight: number }
type Arrow = { x1: number; y1: number; x2: number; y2: number }
const distanceToBox = (x: number, y: number, box: Box) => Math.hypot(Math.max(0, Math.abs(x - box.x) - box.boxWidth / 2), Math.max(0, Math.abs(y - box.y) - box.boxHeight / 2))
function expectMotionClear(boxes: Box[], arrows: Arrow[], clearance: number) {
  // Sample the actual painted shaft and arrowhead boundaries, independent of the
  // placement helper's slab-intersection decision and candidate search.
  for (const arrow of arrows) {
    const head = projectedOperationArrowHead(arrow, 12)
    const segments = [[arrow.x1, arrow.y1, arrow.x2, arrow.y2], ...(head ? [
      [...head.tip, ...head.left], [...head.left, ...head.right], [...head.right, ...head.tip],
    ] : [])]
    for (const [x1, y1, x2, y2] of segments) for (let i = 0; i <= 100; i++) {
      const x = x1 + (x2 - x1) * i / 100, y = y1 + (y2 - y1) * i / 100
      for (const box of boxes) expect(distanceToBox(x, y, box)).toBeGreaterThan(clearance)
    }
  }
}

describe('projected assembly annotations without model planning', () => {
  it('separates overlapping short horizontal action labels from both real arrows and material circles on a phone', () => {
    const arrows = [{ x1: 202, y1: 158, x2: 185, y2: 166 }, { x1: 148, y1: 190, x2: 171, y2: 179 }]
    const marks = [{ x: 202, y: 158, label: '①', boxWidth: 26, boxHeight: 26 }, { x: 158, y: 183, label: '②', boxWidth: 26, boxHeight: 26 }]
    const materialMarks = [{ x: 15, y: 178, radius: 12 }, { x: 303, y: 178, radius: 12 }]
    const input = structuredClone({ marks, arrows, materialMarks })
    const boxes = layoutOperationCallouts(marks, 318, 356, { arrows, materialMarks, gap: 6, arrowClearance: 8 })
    expect({ marks, arrows, materialMarks }).toEqual(input)
    expect(boxes.map(box => box.label)).toEqual(['①', '②'])
    expect(boxes.every(box => box.placementClear)).toBe(true)
    boxes.forEach((box, i) => {
      expect([box.anchorX, box.anchorY]).toEqual([marks[i].x, marks[i].y])
      expect(box.x - box.boxWidth / 2).toBeGreaterThanOrEqual(3)
      expect(box.x + box.boxWidth / 2).toBeLessThanOrEqual(315)
      expect(box.y - box.boxHeight / 2).toBeGreaterThanOrEqual(3)
      expect(box.y + box.boxHeight / 2).toBeLessThanOrEqual(353)
      for (const mark of materialMarks) expect(distanceToBox(mark.x, mark.y, box)).toBeGreaterThanOrEqual(18)
    })
    expect(Math.abs(boxes[0].x - boxes[1].x) >= 32 || Math.abs(boxes[0].y - boxes[1].y) >= 32).toBe(true)
    expectMotionClear(boxes, arrows, 1)
  })

  it('keeps three-digit and wide measured labels inside the viewport without covering crossing motions or a caption', () => {
    const arrows = [{ x1: 7, y1: 15, x2: 305, y2: 260 }, { x1: 297, y1: 12, x2: 22, y2: 240 }]
    const marks = [{ x: 7, y: 15, label: '(169)', boxWidth: 72, boxHeight: 26 }, { x: 297, y: 12, label: '(170)', boxWidth: 50, boxHeight: 26 }]
    const caption = { x: 159, y: 336, boxWidth: 318, boxHeight: 40 }
    const boxes = layoutOperationCallouts(marks, 318, 356, { arrows, blockedRects: [caption], arrowClearance: 8 })
    expect(boxes.map(box => [box.label, box.boxWidth])).toEqual([['(169)', 72], ['(170)', 50]])
    expect(boxes.every(box => box.placementClear)).toBe(true)
    for (const box of boxes) {
      expect(box.x - box.boxWidth / 2).toBeGreaterThanOrEqual(3)
      expect(box.x + box.boxWidth / 2).toBeLessThanOrEqual(315)
      expect(box.y - box.boxHeight / 2).toBeGreaterThanOrEqual(3)
      expect(box.y + box.boxHeight / 2).toBeLessThanOrEqual(310)
    }
    expectMotionClear(boxes, arrows, 1)
  })

  it('retains labels and reports unavailable space instead of silently deleting an action number', () => {
    const marks = [{ x: 30, y: 20, label: '(134)', boxWidth: 50, boxHeight: 26 }]
    const boxes = layoutOperationCallouts(marks, 60, 40, { blockedRects: [{ x: 30, y: 20, boxWidth: 60, boxHeight: 40 }] })
    expect(boxes).toHaveLength(1)
    expect(boxes[0].label).toBe('(134)')
    expect(boxes[0].placementClear).toBe(false)
    const tiny = layoutOperationCallouts([{ x: 10, y: 10, label: '①', boxWidth: 26, boxHeight: 26 }], 20, 20)
    expect(tiny[0].placementClear).toBe(false)
    expect(tiny[0].label).toBe('①')
  })

  it('a short arrowhead ends at the true target and stays within the motion length; zero projection invents no arrow', () => {
    const arrow = { x1: 10, y1: 20, x2: 12, y2: 20 }
    const head = projectedOperationArrowHead(arrow, 30)!
    expect(head.tip).toEqual([12, 20])
    for (const vertex of [head.left, head.right]) expect(vertex[0]).toBeGreaterThanOrEqual(10)
    expect(projectedOperationArrowHead({ x1: 10, y1: 20, x2: 10, y2: 20 }, 30)).toBeNull()
    expect(arrow).toEqual({ x1: 10, y1: 20, x2: 12, y2: 20 })
  })

  it('PDF paints white shaft/head contrast at the exact projected motion and measures the full numeric label', () => {
    let path: number[][] = []
    const strokes: { color: string; width: number; path: number[][] }[] = []
    const fills: { color: string; path: number[][] }[] = []
    const boxes: number[][] = []
    const texts: string[] = []
    const state: any = {
      measureText: (text: string) => ({ width: text.length * 18 }),
      beginPath: () => { path = [] }, moveTo: (...p: number[]) => path.push(p), lineTo: (...p: number[]) => path.push(p),
      stroke: () => strokes.push({ color: state.strokeStyle, width: state.lineWidth, path: structuredClone(path) }),
      fill: () => fills.push({ color: state.fillStyle, path: structuredClone(path) }),
      fillRect: (...p: number[]) => boxes.push(p), fillText: (text: string) => texts.push(text),
    }
    const ctx = new Proxy(state, { get: (target, name) => name in target ? target[name] : () => {} })
    const arrows = [{ order: 134, from: { u: 0.4, v: 0.4 }, to: { u: 0.6, v: 0.4 } }]
    drawManualArrows(ctx, { width: 400, height: 300 }, 100, 50, 400, 300, arrows)
    const white = strokes.find(stroke => stroke.color === '#fff' && stroke.width === 18)!
    const ink = strokes.find(stroke => stroke.color === '#b33d00' && stroke.width === 7)!
    expect(white.path).toEqual([[260, 170], [340, 170]])
    expect(ink.path).toEqual(white.path)
    expect(strokes.some(stroke => stroke.color === '#fff' && stroke.width === 11 && stroke.path[0][0] === 340 && stroke.path[0][1] === 170)).toBe(true)
    expect(fills.find(fill => fill.color === '#b33d00')!.path[0]).toEqual([340, 170])
    expect(texts).toEqual(['(134)'])
    expect(boxes[0][2]).toBeGreaterThanOrEqual(90 + 20)
    expect(boxes[0][0]).toBeGreaterThanOrEqual(100)
    expect(boxes[0][0] + boxes[0][2]).toBeLessThanOrEqual(500)
    expect(arrows[0]).toEqual({ order: 134, from: { u: 0.4, v: 0.4 }, to: { u: 0.6, v: 0.4 } })
  })

  it('nontranslation orient/prepare actions retain their visible transformed anchor and number without fabricated arrows', () => {
    const model = new BuildModel()
    const visible = model.addNode(10, 20, 30), future = model.addNode(40, 50, 60)
    const snapshot = model.toJSON()
    const state = { visible: new Set([visible.id]), transforms: new Map([[visible.id, [5, 0, -10]]]), arrows: [],
      operationNumbers: [{ id: 'orient', order: 3, partIds: [visible.id] }, { id: 'prepare', order: 134, partIds: [visible.id] }, { id: 'future', order: 135, partIds: [future.id] }] }
    const projectedPositions: number[][] = []
    const scene = { projectWorld: (positions: number[][]) => {
      projectedPositions.push(...positions)
      return positions.map(p => ({ u: p[0] / 100, v: p[1] / 100 }))
    } }
    const operationMarks = projectOperationMarks(scene, model, state, 4 / 3)
    expect(projectedPositions).toEqual([[15, 20, 20], [15, 20, 20]])
    expect(operationMarks.map(mark => mark.order)).toEqual([3, 134])
    expect(model.toJSON()).toEqual(snapshot)
    let path: number[][] = []
    const strokes: { color: string; path: number[][] }[] = []
    const texts: string[] = []
    const canvas: any = { measureText: (text: string) => ({ width: text.length * 18 }), beginPath: () => { path = [] },
      moveTo: (...p: number[]) => path.push(p), lineTo: (...p: number[]) => path.push(p), fillText: (text: string) => texts.push(text),
      stroke: () => strokes.push({ color: canvas.strokeStyle, path: structuredClone(path) }) }
    const ctx = new Proxy(canvas, { get: (target, name) => name in target ? target[name] : () => {} })
    drawManualArrows(ctx, { width: 400, height: 300 }, 100, 50, 400, 300, [], [], true, operationMarks)
    expect(texts).toEqual(['③', '(134)'])
    expect(strokes.filter(stroke => stroke.path.length === 2).map(stroke => stroke.path[0])).toEqual([[160, 110], [160, 110], [160, 110], [160, 110]])
    expect(strokes.some(stroke => stroke.color === '#b33d00')).toBe(false)
    expect(state.arrows).toEqual([])
  })
})
