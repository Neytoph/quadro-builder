import { describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'

type V = [number, number, number]

const CS = 5
const STEP = 5
const OPTS = { step: STEP, cs: CS }
// 第一根管的节点间距，75 cm 的管加一个连接件。
const L1 = 80

const AXES: Record<string, { u: V; off: V }> = {
  x: { u: [1, 0, 0], off: [0, 0, CS] },
  y: { u: [0, 1, 0], off: [CS, 0, 0] },
  z: { u: [0, 0, 1], off: [0, CS, 0] },
}

const add = (p: V, q: V): V => [p[0] + q[0], p[1] + q[1], p[2] + q[2]]
const mul = (u: V, s: number): V => [u[0] * s, u[1] * s, u[2] * s]

// 第一根管从 origin 沿 u 伸出 L1，夹子夹在 t 处，空孔在 off 那一侧。
function setup(axis: string, t: number, { reverse = false } = {}) {
  const { u, off } = AXES[axis]
  const origin: V = [20, 40, 60]
  const m = new BuildModel()
  const a = m.addNode(...origin)
  const b = m.addNode(...add(origin, mul(u, L1)))
  if (reverse) m.addTube(b.id, a.id, 'T75', 'blue', 75)
  else m.addTube(a.id, b.id, 'T75', 'blue', 75)
  const c = m.addClamp(...add(origin, mul(u, t)))
  c.dir = reverse ? mul(u, -1) : u.slice()
  c.off = off.slice()
  // 第二根管在第一根的坐标里（沿 u，从 origin 量起）从 s 到 s + span 时的两端。
  const along = (s: number): V => add(add(origin, off), mul(u, s))
  return { m, c, along }
}

// 两端不分先后：比较时按沿 u 的顺序排好。
function ends(m: BuildModel, clampId: string, span: number, axis: string) {
  const r = m.secondTubeEnds(clampId, span, OPTS)
  const i = AXES[axis].u.indexOf(1)
  const pair = [r.p1, r.p2].sort((p, q) => p[i] - q[i])
  return { align: r.align, lo: pair[0], hi: pair[1] }
}

function expectAt(got: number[], want: V) {
  for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 6)
}

describe.each(['x', 'y', 'z'])('双管连接的第二根管，沿 %s 方向', (axis) => {
  it('一样长：两端和第一根的两端对齐（夹子在中间）', () => {
    const { m, c, along } = setup(axis, 40)
    const r = ends(m, c.id, L1, axis)
    expect(r.align).toBe('both')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(L1))
  })

  it('一样长：两端和第一根的两端对齐（夹子靠近一端）', () => {
    const { m, c, along } = setup(axis, 70)
    const r = ends(m, c.id, L1, axis)
    expect(r.align).toBe('both')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(L1))
  })

  it('一样长：第一根管的方向反过来也对齐', () => {
    const { m, c, along } = setup(axis, 25, { reverse: true })
    const r = ends(m, c.id, L1, axis)
    expect(r.align).toBe('both')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(L1))
  })

  it('第二根更长，夹子靠近坐标较小的一端：和这一端对齐', () => {
    const { m, c, along } = setup(axis, 10)
    const r = ends(m, c.id, 120, axis)
    expect(r.align).toBe('end')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(120))
  })

  it('第二根更长，夹子靠近坐标较大的一端：和这一端对齐', () => {
    const { m, c, along } = setup(axis, 70, { reverse: true })
    const r = ends(m, c.id, 120, axis)
    expect(r.align).toBe('end')
    expectAt(r.lo, along(L1 - 120))
    expectAt(r.hi, along(L1))
  })

  it('第二根更长，夹子在中间：和坐标较小的一端对齐', () => {
    const { m, c, along } = setup(axis, 40)
    const r = ends(m, c.id, 120, axis)
    expect(r.align).toBe('end')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(120))
  })

  it('第二根更短，夹子靠近一端：和这一端对齐，夹子仍在管身上', () => {
    const { m, c, along } = setup(axis, 70)
    const r = ends(m, c.id, 40, axis)
    expect(r.align).toBe('end')
    expectAt(r.lo, along(L1 - 40))
    expectAt(r.hi, along(L1))
  })

  it('第二根更短，夹子在中间且够得着：和坐标较小的一端对齐', () => {
    const { m, c, along } = setup(axis, 40)
    const r = ends(m, c.id, 60, axis)
    expect(r.align).toBe('end')
    expectAt(r.lo, along(0))
    expectAt(r.hi, along(60))
  })

  it('第二根更短，夹子会落在连接件上：按夹子居中摆，并对齐网格', () => {
    const { m, c, along } = setup(axis, 40)
    const r = ends(m, c.id, 40, axis)
    expect(r.align).toBe('center')
    expectAt(r.lo, along(20))
    expectAt(r.hi, along(60))
  })

  it('第二根更短，哪一端都夹不住：按夹子居中摆', () => {
    const { m, c, along } = setup(axis, 35)
    const r = ends(m, c.id, 25, axis)
    expect(r.align).toBe('center')
    // 以夹子为中心起点在 22.5，origin 在网格上，起点按 5 cm 网格取到 25。
    expectAt(r.lo, along(25))
    expectAt(r.hi, along(50))
  })
})

describe('找不到第一根管', () => {
  it('夹子下面没有管：按夹子居中摆', () => {
    const m = new BuildModel()
    const c = m.addClamp(0, 40, 0)
    c.dir = [1, 0, 0]
    c.off = [0, 0, CS]
    const r = m.secondTubeEnds(c.id, 40, OPTS)
    expect(r.align).toBe('center')
    expectAt(r.p1, [-20, 40, CS])
    expectAt(r.p2, [20, 40, CS])
  })

  it('夹子不存在：直接报错', () => {
    const m = new BuildModel()
    expect(() => m.secondTubeEnds('k999', 40, OPTS)).toThrow()
  })
})
