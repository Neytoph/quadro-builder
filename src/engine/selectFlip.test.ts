import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import * as Y from 'yjs'
import { loadCatalog } from './catalog.js'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { t } from './i18n.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

// 选择模式里再点选中的面板就翻面。真的往画布元素上发指针事件，走 Builder 自己的事件处理；
// 三维场景换成一个按屏幕位置给出固定命中列表的替身（WebGL 在 happy-dom 里没有），
// 真实画面里的点击由 scripts/e2e-flip.mjs 在浏览器里走一遍。

beforeAll(async () => { await loadCatalog() })

function need<T>(x: T | null, what: string): T {
  if (x == null) throw new Error(`${what} failed`)
  return x
}

// 两格并排的平台，每格铺一块板
function platform() {
  const m = new BuildModel()
  const n = [[0, 0], [40, 0], [80, 0], [0, 40], [40, 40], [80, 40]].map(([x, z]) => m.addNode(x, 0, z))
  const tube = (i: number, j: number) => need(m.addTube(n[i].id, n[j].id, 'T35', 'blue', 35), 'addTube')
  const front = tube(0, 1), back = tube(3, 4)
  tube(1, 2); tube(4, 5); tube(0, 3)
  const mid = tube(1, 4), right = tube(2, 5)
  const p1 = need(m.addPanel(front.id, back.id, 0, 40, 'panel_40x40', 'green', 1), 'addPanel')
  const p2 = need(m.addPanel(mid.id, right.id, 0, 40, 'panel_40x40', 'yellow', 1), 'addPanel')
  return { m, p1: p1.id as string, p2: p2.id as string, front: front.id as string, nodeA: n[0].id as string }
}

type Hit = { kind: string; id: string }
type Spot = { x: number; y: number }
// 屏幕上的几处：P1 最前面是第一块板、后面压着前面那根管；P2 只有第二块板；TUBE 最前面是那根管、后面是接头
const P1: Spot = { x: 100, y: 100 }
const P2: Spot = { x: 300, y: 100 }
const TUBE: Spot = { x: 100, y: 300 }

function stage(m: BuildModel, hitsAt: (x: number, y: number) => Hit[]) {
  const el = document.createElement('div')
  const pick = (x: number, y: number) => hitsAt(x, y).map((h, i) => ({
    data: { kind: h.kind, id: h.id }, distance: 100 + i * 40, point: new THREE.Vector3(x / 2, 0, y / 2), object: null,
  }))
  const base: Record<string, unknown> = {
    renderer: { domElement: el },
    container: el,
    pickAllForDelete: (x: number, y: number) => pick(x, y),
    pickForDelete: (x: number, y: number) => pick(x, y)[0] || null,
    pickClamp: () => null,
    pickViewCube: () => null,
    dragAxes: () => ({ u: [1, 0, 0], v: [0, 0, 1] }),
    dragPlanePoint: (x: number, y: number) => new THREE.Vector3(x / 2, 0, y / 2),
    selectableParts: () => {
      const vis = new Map<string, string>()
      for (const id of m.nodes.keys()) vis.set(id, 'node')
      for (const id of m.tubes.keys()) vis.set(id, 'tube')
      for (const id of m.panels.keys()) vis.set(id, 'panel')
      return vis
    },
  }
  const scene = new Proxy(base, { get: (o, k: string) => (k in o ? o[k] : () => null) })
  return { el, scene }
}

function setup(opts: { history?: ModelHistory } = {}) {
  const w = platform()
  const hitsAt = (x: number, y: number): Hit[] => {
    const near = (s: Spot) => Math.hypot(x - s.x, y - s.y) < 30
    if (near(P1)) return [{ kind: 'panel', id: w.p1 }, { kind: 'tube', id: w.front }]
    if (near(P2)) return [{ kind: 'panel', id: w.p2 }]
    if (near(TUBE)) return [{ kind: 'tube', id: w.front }, { kind: 'node', id: w.nodeA }]
    return []
  }
  const { el, scene } = stage(w.m, hitsAt)
  const b = new Builder(scene, w.m)
  b.setHistory(opts.history || new ModelHistory(docFromJSON(w.m.toJSON())))
  const notices: Array<[string, string]> = []
  ;(b as unknown as { onNotice: (msg: string, kind: string) => void }).onNotice = (msg, kind) => { notices.push([msg, kind]) }
  b.setMode('select')
  return { ...w, b, el, notices }
}

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
type PType = 'mouse' | 'touch'
function pointer(el: HTMLElement, type: string, p: Spot, mods: Mods = {}, pointerType: PType = 'mouse', buttons = 0) {
  el.dispatchEvent(new PointerEvent(type, {
    clientX: p.x, clientY: p.y, button: 0, buttons, pointerId: 1, pointerType, bubbles: true, ...mods,
  }))
}
function click(el: HTMLElement, p: Spot, mods: Mods = {}, pointerType: PType = 'mouse') {
  pointer(el, 'pointerdown', p, mods, pointerType, 1)
  pointer(el, 'pointerup', p, mods, pointerType)
}
// 慢慢点：点完等过选整块的时间窗口（翻面也在这之后执行）
const PAUSE = 700
function slowClick(el: HTMLElement, p: Spot, mods: Mods = {}, pointerType: PType = 'mouse') {
  click(el, p, mods, pointerType)
  vi.advanceTimersByTime(PAUSE)
}
const selected = (b: Builder) => [...b.selection.keys()]
const side = (m: BuildModel, id: string) => m.panels.get(id).side

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }) })
afterEach(() => { vi.useRealTimers() })

describe('选择模式：再点选中的面板就翻面', () => {
  it('点没选中的面板：只选中它，不翻', () => {
    const { b, el, m, p1 } = setup()
    slowClick(el, P1)
    expect(selected(b)).toEqual([p1])
    expect(side(m, p1)).toBe(1)
  })

  it('隔一会儿再点：翻到另一面，给提示，能撤销，还选着它', () => {
    const { b, el, m, p1, notices } = setup()
    slowClick(el, P1)
    slowClick(el, P1)
    expect(side(m, p1)).toBe(-1)
    expect(notices.at(-1)).toEqual([t('notice_panel_below'), 'info'])
    expect(selected(b)).toEqual([p1])
    slowClick(el, P1)
    expect(side(m, p1)).toBe(1)
    expect(notices.at(-1)).toEqual([t('notice_panel_above'), 'info'])
    b.undo()
    expect(side(m, p1)).toBe(-1)
    b.undo()
    expect(side(m, p1)).toBe(1)
    expect(b.canUndo()).toBe(false)
  })

  it('翻面等过选整块的时间窗口才执行', () => {
    const { el, m, p1 } = setup()
    slowClick(el, P1)
    click(el, P1)
    vi.advanceTimersByTime(499)
    expect(side(m, p1)).toBe(1)
    vi.advanceTimersByTime(1)
    expect(side(m, p1)).toBe(-1)
  })

  it('500 毫秒内第二下：选整块，不翻', () => {
    const { b, el, m, p1, p2 } = setup()
    slowClick(el, P1)
    click(el, P1)                 // 这一下排上了翻面
    vi.advanceTimersByTime(200)
    click(el, P1)                 // 快的第二下：选整块，翻面作废
    vi.advanceTimersByTime(2000)
    expect(side(m, p1)).toBe(1)
    expect(selected(b)).toContain(p1)
    expect(selected(b)).toContain(p2)
    expect(b.selection.size).toBeGreaterThan(2)
  })

  it('双击：选整块，不翻', () => {
    const { b, el, m, p1, p2 } = setup()
    slowClick(el, P1)
    click(el, P1)
    el.dispatchEvent(new MouseEvent('dblclick', { clientX: P1.x, clientY: P1.y, bubbles: true }))
    vi.advanceTimersByTime(2000)
    expect(side(m, p1)).toBe(1)
    expect(selected(b)).toContain(p2)
  })

  it('Shift / Ctrl / ⌘ 点选中的面板：不翻', () => {
    for (const mods of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const { b, el, m, p1 } = setup()
      slowClick(el, P1)
      slowClick(el, P1, mods)
      expect(side(m, p1)).toBe(1)
      expect(b.canUndo()).toBe(false)
    }
  })

  it('拖动选中的面板：不翻', () => {
    const { el, m, p1 } = setup()
    slowClick(el, P1)
    pointer(el, 'pointerdown', P1, {}, 'mouse', 1)
    for (let i = 1; i <= 5; i++) pointer(el, 'pointermove', { x: P1.x + i * 8, y: P1.y }, {}, 'mouse', 1)
    pointer(el, 'pointerup', { x: P1.x + 40, y: P1.y })
    vi.advanceTimersByTime(PAUSE)
    expect(side(m, p1)).toBe(1)
  })

  it('选着好几件时点其中一块：先变成只选它，再点才翻', () => {
    const { b, el, m, p1, p2 } = setup()
    b.selection = new Map([[p1, 'panel'], [p2, 'panel']])
    slowClick(el, P1)
    expect(selected(b)).toEqual([p1])
    expect(side(m, p1)).toBe(1)
    slowClick(el, P1)
    expect(side(m, p1)).toBe(-1)
  })

  it('成组的面板：选着这一组，再点只翻点到的那块', () => {
    const { b, el, m, p1, p2 } = setup()
    m.groupParts([p1, p2])
    slowClick(el, P1)
    expect(selected(b).sort()).toEqual([p1, p2].sort())
    slowClick(el, P1)
    expect(side(m, p1)).toBe(-1)
    expect(side(m, p2)).toBe(1)
  })

  it('面板后面还压着零件：同一处再点是翻面，不往里选', () => {
    const { b, el, m, p1 } = setup()
    slowClick(el, P1)
    slowClick(el, { x: P1.x + 2, y: P1.y + 1 })
    expect(side(m, p1)).toBe(-1)
    expect(selected(b)).toEqual([p1])
  })

  it('选着管子：同一处隔一会儿再点照旧往里选', () => {
    const { b, el, front, nodeA } = setup()
    slowClick(el, TUBE)
    expect(selected(b)).toEqual([front])
    slowClick(el, TUBE)
    expect(selected(b)).toEqual([nodeA])
  })

  it('点另一块没选中的面板：改选它，两块都不翻', () => {
    const { b, el, m, p1, p2 } = setup()
    slowClick(el, P1)
    slowClick(el, P2)
    expect(selected(b)).toEqual([p2])
    expect(side(m, p1)).toBe(1)
    expect(side(m, p2)).toBe(1)
  })

  it('触屏：再点一下选中的面板也翻', () => {
    const { el, m, p1 } = setup()
    slowClick(el, P1, {}, 'touch')
    slowClick(el, P1, {}, 'touch')
    expect(side(m, p1)).toBe(-1)
  })

  it('翻面还排着的时候撤销：撤的就是这次翻面', () => {
    const { b, el, m, p1 } = setup()
    slowClick(el, P1)
    click(el, P1)
    b.undo()
    expect(side(m, p1)).toBe(1)
    vi.advanceTimersByTime(PAUSE)
    expect(side(m, p1)).toBe(1)
    expect(b.canRedo()).toBe(true)
  })

  it('翻面还排着的时候在别处按下：先翻完', () => {
    const { b, el, m, p1, p2 } = setup()
    slowClick(el, P1)
    click(el, P1)
    vi.advanceTimersByTime(100)
    click(el, P2)
    expect(side(m, p1)).toBe(-1)
    vi.advanceTimersByTime(PAUSE)
    expect(selected(b)).toEqual([p2])
    expect(side(m, p2)).toBe(1)
  })

  it('只能看：再点不翻，不记撤销，也不弹只能看的提示', () => {
    const { b, el, m, p1, notices } = setup()
    b.setReadOnly(true)
    slowClick(el, P1)
    expect(selected(b)).toEqual([p1])
    slowClick(el, P1)
    expect(side(m, p1)).toBe(1)
    expect(b.canUndo()).toBe(false)
    expect(notices.some(([msg]) => msg === t('notice_read_only'))).toBe(false)
  })

  it('共享方案：翻面写进共享文档，另一端看得到；撤销也同步过去', () => {
    const w = platform()
    const a = docFromJSON(w.m.toJSON())
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(a))
    a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(other, u, 'remote') })
    other.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'remote') Y.applyUpdate(a, u, 'remote') })
    // 另一端：只读文档、跟着重新载入
    const theirs = new BuildModel()
    const theirHistory = new ModelHistory(other)
    theirHistory.onExternal(() => { theirs.loadJSON(theirHistory.toJSON()) })
    theirs.loadJSON(theirHistory.toJSON())

    const { b, el, m, p1 } = setup({ history: new ModelHistory(a) })
    b.applyExternal(b.history.toJSON())
    slowClick(el, P1)
    slowClick(el, P1)
    expect(side(m, p1)).toBe(-1)
    expect(theirs.panels.get(p1).side).toBe(-1)
    b.undo()
    expect(side(m, p1)).toBe(1)
    expect(theirs.panels.get(p1).side).toBe(1)
  })
})
