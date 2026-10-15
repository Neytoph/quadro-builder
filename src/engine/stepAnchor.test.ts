import { describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { pickStepAnchor, stepCandidates, stepCandidatesFromSelection, stepNeighbor } from './stepAnchor.js'

type V = [number, number, number]
type N = { id: string; x: number; y: number; z: number }

// 35 cm 的管，节点间距 40
const SPAN = 40
const X: V = [1, 0, 0]
const NX: V = [-1, 0, 0]
const UP: V = [0, 1, 0]
const Z: V = [0, 0, 1]

// 接头往 dir 那一侧有没有插着管子
function armFree(m: BuildModel, n: N, dir: number[]) {
  for (const t of m.tubes.values()) {
    if (t.link) continue
    const other = t.a === n.id ? m.nodes.get(t.b) : t.b === n.id ? m.nodes.get(t.a) : null
    if (!other) continue
    const d = [other.x - n.x, other.y - n.y, other.z - n.z]
    const L = Math.hypot(d[0], d[1], d[2])
    if ((d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / L > 0.9) return false
  }
  return true
}

// 照 Builder.buildStep 的顺序：挑出发接头，往 dir 接一根，返回新端点
function step(m: BuildModel, from: string[], dir: V) {
  const n = pickStepAnchor(m, from, dir, (node: N, d: number[]) => armFree(m, node, d))
  if (!n) return null
  const res = m.extend(n.id, dir, 'T35', 'blue', 35, SPAN)
  if (!res) throw new Error(`extend from ${n.id} failed`)
  return { from: n, res }
}

// 模拟鼠标在 fromId 上往 dir 加一根，返回新端点
function grow(m: BuildModel, fromId: string, dir: V) {
  const res = m.extend(fromId, dir, 'T35', 'blue', 35, SPAN)
  if (!res || !res.node) throw new Error(`extend from ${fromId} failed`)
  return res.node
}

// step 接出去的新端点
function endOf(r: ReturnType<typeof step>) {
  if (!r || !r.res.node) throw new Error('no tube grown')
  return r.res.node.id
}

const at = (m: BuildModel, id: string): V => {
  const n = m.nodes.get(id)
  return [n.x, n.y, n.z]
}

describe('方向键沿已有管子移动接头', () => {
  it.each<V>([X, NX, UP, [0, -1, 0], Z, [0, 0, -1]])('沿 %j 移动到实际相邻端点', (...dir) => {
    const m = new BuildModel()
    const a = m.addNode(0, 80, 0)
    const b = m.addNode(a.x + dir[0] * 20, a.y + dir[1] * 20, a.z + dir[2] * 20)
    m.addTube(a.id, b.id, 'T15', 'blue', 15)
    const before = m.toJSON()
    expect(stepNeighbor(m, a, dir)).toBe(b)
    expect(stepNeighbor(m, b, dir.map(v => -v))).toBe(a)
    expect(m.toJSON()).toEqual(before)
  })

  it('一次只走一根管，连续按键逐个经过不同长度的管子', () => {
    const m = new BuildModel()
    const a = m.addNode(0, 0, 0), b = m.addNode(20, 0, 0), c = m.addNode(60, 0, 0)
    m.addTube(a.id, b.id, 'T15', 'blue', 15)
    m.addTube(b.id, c.id, 'T35', 'green', 35)
    expect(stepNeighbor(m, a, X)).toBe(b)
    expect(stepNeighbor(m, b, X)).toBe(c)
    expect(stepNeighbor(m, c, X)).toBeNull()
  })

  it('同方向但未连接的节点、空方向和已删除端点不跳转', () => {
    const { m, a, b } = oneTube()
    expect(stepNeighbor(m, a, UP)).toBeNull()
    expect(stepNeighbor(m, a, [0, 0, 0])).toBeNull()
    m.removeTube([...m.tubes.keys()][0])
    expect(stepNeighbor(m, a, X)).toBeNull()
    m.nodes.delete(b.id)
    expect(stepNeighbor(m, a, X)).toBeNull()
  })

  it('双管连接和斜角适配器不当作可移动的普通管子', () => {
    const m = new BuildModel()
    const a = m.addNode(0, 20, 0), b = m.addNode(5, 20, 0)
    m.addLink(a.id, b.id)
    expect(stepNeighbor(m, a, X)).toBeNull()
    m.tubes.clear()
    const tube = m.addTube(a.id, b.id, 'T35', 'blue', 35)
    if (!tube) throw new Error('addTube failed')
    Object.assign(tube, { arm: true })
    expect(stepNeighbor(m, a, X)).toBeNull()
    Object.assign(tube, { arm: false })
    b.c45body = true
    expect(stepNeighbor(m, a, X)).toBeNull()
    b.c45body = false
    b.unused = true
    expect(stepNeighbor(m, a, X)).toBeNull()
  })
})

// 一根管：a 在 (0,20,0)，b 在 (40,20,0)
function oneTube() {
  const m = new BuildModel()
  const a = m.addNode(0, 20, 0)
  const b = m.addNode(SPAN, 20, 0)
  const t = m.addTube(a.id, b.id, 'T35', 'blue', 35)
  return { m, a, b, t }
}

describe('方向键接管从哪个接头出发', () => {
  it('只有第一个接头：从它接', () => {
    const m = new BuildModel()
    const a = m.addNode(0, 0, 0)
    const from = stepCandidates(m, null, [])
    expect(from).toEqual([a.id])
    const r = step(m, from, X)
    expect(r?.res.tube).toBeTruthy()
    expect(at(m, endOf(r))).toEqual([SPAN, 0, 0])
  })

  it('刚放下第一根、没有点选接头：往管子方向从前面那头接', () => {
    const { m, a, b } = oneTube()
    const from = stepCandidates(m, null, [])
    expect(step(m, from, X)?.from.id).toBe(b.id)
    expect(step(m, from, NX)?.from.id).toBe(a.id)
    expect([...m.tubes.values()].length).toBe(3)
  })

  it('刚放下第一根、往侧面或上面：从一头接出一根，不落空', () => {
    const { m, b } = oneTube()
    const r = step(m, stepCandidates(m, null, []), UP)
    expect(r?.from.id).toBe(b.id)
    expect(at(m, endOf(r))).toEqual([SPAN, 20 + SPAN, 0])
  })

  it('鼠标刚加完一根：从新端点接', () => {
    const { m, b } = oneTube()
    // 鼠标在 b 上往上加了一根，stepFrom 记着新端点
    const up = grow(m, b.id, UP)
    const r = step(m, stepCandidates(m, null, [up.id]), Z)
    expect(r?.from.id).toBe(up.id)
    expect(at(m, endOf(r))).toEqual([SPAN, 20 + SPAN, SPAN])
  })

  it('点选了一个接头：从它接，stepFrom 让位', () => {
    const { m, a, b } = oneTube()
    const up = grow(m, b.id, UP)
    const r = step(m, stepCandidates(m, a.id, [up.id]), Z)
    expect(r?.from.id).toBe(a.id)
    expect(at(m, endOf(r))).toEqual([0, 20, SPAN])
  })

  it('从选择模式带着一根管切过来：往管子方向从前面那头接，侧面从空着的一头接', () => {
    const { m, a, b } = oneTube()
    // b 上往 +z 已经插了一根，往 +z 只剩 a 空着
    grow(m, b.id, Z)
    const t = [...m.tubes.values()].find((x) => (x.a === a.id && x.b === b.id))!
    const from = stepCandidatesFromSelection(m, new Map([[t.id, 'tube']]))
    expect(new Set(from)).toEqual(new Set([a.id, b.id]))
    expect(step(m, from, NX)?.from.id).toBe(a.id)
    const r = step(m, from, Z)
    expect(r?.from.id).toBe(a.id)
    expect(r?.res.tube).toBeTruthy()
  })

  it('从选择模式带着一个接头切过来：从这个接头接', () => {
    const { m, a } = oneTube()
    const from = stepCandidatesFromSelection(m, new Map([[a.id, 'node']]))
    expect(from).toEqual([a.id])
    expect(step(m, from, UP)?.from.id).toBe(a.id)
  })

  it('选中的是双管连接或斜角接头：不当作出发点', () => {
    const { m, a } = oneTube()
    const c = m.addNode(0, 20, 5)
    c.c45body = true
    const link = m.addLink(a.id, c.id)
    if (!link) throw new Error('addLink failed')
    const from = stepCandidatesFromSelection(m, new Map([[c.id, 'node'], [link.id, 'tube']]))
    expect(from).toEqual([])
  })

  it('造型不止一根管、也没有点选或刚加的接头：不知道从哪接', () => {
    const { m, b } = oneTube()
    grow(m, b.id, UP)
    const from = stepCandidates(m, null, [])
    expect(from).toEqual([])
    expect(step(m, from, X)).toBeNull()
  })

  it('stepFrom 里的接头被撤销掉了：当作没有', () => {
    const { m, b } = oneTube()
    const up = grow(m, b.id, UP)
    grow(m, b.id, Z)
    m.removeNode(up.id)
    expect(stepCandidates(m, null, [up.id])).toEqual([])
  })

  it('共享方案标签页：带本端标记的 id 经过文档读回以后照样能接', () => {
    const m = new BuildModel()
    m.idTag = 'k7:'
    const a = m.addNode(0, 20, 0)
    const b = m.addNode(SPAN, 20, 0)
    m.addTube(a.id, b.id, 'T35', 'blue', 35)
    const up = grow(m, b.id, UP)
    expect(up.id.startsWith('n') && up.id.includes('k7:')).toBe(true)
    // 别处的修改读回来：整座造型从 JSON 重新载入
    const back = new BuildModel()
    back.idTag = 'k7:'
    expect(back.loadJSON(JSON.parse(JSON.stringify(m.toJSON()))).ok).toBe(true)
    const r = step(back, stepCandidates(back, null, [up.id]), X)
    expect(r?.from.id).toBe(up.id)
    expect(at(back, endOf(r))).toEqual([2 * SPAN, 20 + SPAN, 0])
  })
})
