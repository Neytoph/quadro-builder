import { BuildModel, POOL_SETS } from '../engine/model.js'
import { buildableTubes, getPanel, getTube } from '../engine/catalog.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from '../engine/config.js'

export interface PresetDef {
  key: string
  labelKey: string
  hint: string
  /** replace = 整表替换（金字塔）；place = 挂到指针上插入 */
  mode?: 'place' | 'replace'
}

export interface ModuleGroup {
  key: 'basic' | 'play' | 'roof'
  labelKey: string
  items: PresetDef[]
}

/** 基础几何：点一下跟指针走，放到现有造型上会合并去重。 */
export const BASIC_MODULES: PresetDef[] = [
  { key: 'cube', labelKey: 'preset.cube', hint: '1×1×1' },
  { key: 'box211', labelKey: 'preset.box211', hint: '2×1×1' },
  { key: 'box221', labelKey: 'preset.box221', hint: '2×2×1' },
  { key: 'box212', labelKey: 'preset.box212', hint: '2×1×2' },
  { key: 'tower', labelKey: 'preset.tower', hint: '1×1×2' },
  { key: 'table', labelKey: 'preset.table', hint: '2×1' },
  { key: 'tunnel', labelKey: 'preset.tunnel', hint: '1×1×3' },
]

/** 游乐单元：平台、台阶、滑梯、桥、攀爬架、秋千架、沙坑。全部按官方网格用日常件搭出来。 */
export const PLAY_MODULES: PresetDef[] = [
  { key: 'rail_deck', labelKey: 'preset.rail_deck', hint: '2×2 · 40 cm' },
  { key: 'rail_deck_tall', labelKey: 'preset.rail_deck_tall', hint: '2×2 · 80 cm' },
  { key: 'steps2', labelKey: 'preset.steps2', hint: '2×1 · 40 / 80 cm' },
  { key: 'steps_l', labelKey: 'preset.steps_l', hint: '2×2 · 40 / 80 / 120 cm' },
  { key: 'slide_tower', labelKey: 'preset.slide_tower', hint: '1×1 · 80 cm' },
  { key: 'tunnel_house', labelKey: 'preset.tunnel_house', hint: '1×1×3' },
  { key: 'bridge_towers', labelKey: 'preset.bridge_towers', hint: '3×1 · 80 cm' },
  { key: 'a_frame', labelKey: 'preset.a_frame', hint: '100 × 80 cm · 45°' },
  { key: 'swing_frame', labelKey: 'preset.swing_frame', hint: '80 × 80 · 120 cm' },
  { key: 'sandbox', labelKey: 'preset.sandbox', hint: '80 × 80 · XS' },
]

export const ROOF_MODULES: PresetDef[] = [
  { key: 'roof', labelKey: 'preset.roof', hint: '80 cm' },
  { key: 'roof_large', labelKey: 'preset.roof_large', hint: '160 cm' },
]

export const MODULE_GROUPS: ModuleGroup[] = [
  { key: 'basic', labelKey: 'group.basic', items: BASIC_MODULES },
  { key: 'play', labelKey: 'group.play', items: PLAY_MODULES },
  { key: 'roof', labelKey: 'group.roof', items: ROOF_MODULES },
]

/** 起步造型：整表替换当前设计。 */
export const PRESETS: PresetDef[] = [
  { key: 'pyramid', labelKey: 'preset.pyramid', hint: 'A0128', mode: 'replace' },
]

export const ALL_PRESETS: PresetDef[] = [...BASIC_MODULES, ...PLAY_MODULES, ...ROOF_MODULES, ...PRESETS]

export function presetThumbPath(key: string) {
  // 同 officialThumbPath：跟着产物走的资源要带 base
  return `${import.meta.env.BASE_URL}thumbs/presets/${key}.jpg?v=3`
}

const SPAN = 40
const COLORS = ['red', 'green', 'blue', 'yellow'] as const
/** 板的占位色：放置时会换成当前选中色。 */
export const MODULE_PANEL_COLOR = 'red'

type XYZ = { id: string; x: number; y: number; z: number; c45?: boolean; c45body?: boolean; c45axis?: number[] }
type EngineJson = {
  format: number
  nodes: Array<XYZ & Record<string, unknown>>
  tubes: Array<Record<string, unknown>>
  slides?: Array<Record<string, unknown>>
  fittings?: Array<Record<string, unknown>>
  panels?: Array<Record<string, unknown>>
  textiles?: Array<Record<string, unknown>>
  clamps?: Array<Record<string, unknown>>
}

function packGrid(nx: number, ny: number, nz: number, kind: 'box' | 'table' = 'box'): EngineJson {
  const nodes = new Map<string, XYZ>()
  const tubes: EngineJson['tubes'] = []
  let ni = 1, ti = 1, ci = 0
  const nodeAt = (ix: number, iy: number, iz: number) => {
    const k = `${ix},${iy},${iz}`
    let n = nodes.get(k)
    if (!n) {
      n = { id: `n${ni++}`, x: ix * SPAN, y: iy * SPAN, z: iz * SPAN }
      nodes.set(k, n)
    }
    return n.id
  }
  const tube = (a: string, b: string) => {
    tubes.push({ id: `t${ti++}`, a, b, tubeId: 'T35', color: COLORS[ci++ % COLORS.length], length: 35 })
  }
  const topY = ny
  if (kind === 'box') {
    for (let y = 0; y <= ny; y++)
      for (let z = 0; z <= nz; z++)
        for (let x = 0; x < nx; x++)
          tube(nodeAt(x, y, z), nodeAt(x + 1, y, z))
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        for (let z = 0; z < nz; z++)
          tube(nodeAt(x, y, z), nodeAt(x, y, z + 1))
    for (let x = 0; x <= nx; x++)
      for (let z = 0; z <= nz; z++)
        for (let y = 0; y < ny; y++)
          tube(nodeAt(x, y, z), nodeAt(x, y + 1, z))
  } else {
    for (let z = 0; z <= nz; z++)
      for (let x = 0; x < nx; x++)
        tube(nodeAt(x, topY, z), nodeAt(x + 1, topY, z))
    for (let x = 0; x <= nx; x++)
      for (let z = 0; z < nz; z++)
        tube(nodeAt(x, topY, z), nodeAt(x, topY, z + 1))
    for (const x of [0, nx])
      for (const z of [0, nz])
        tube(nodeAt(x, 0, z), nodeAt(x, topY, z))
  }
  return { format: 2, nodes: [...nodes.values()], tubes }
}

type Pt = [number, number, number]
type Cell = [number, number]

/**
 * 用引擎逐根接管搭单元：几何全部走 BuildModel，接头类型由 BOM 按真实零件判定。
 * 坐标单位厘米，网格 40。
 */
class Frame {
  readonly m = new BuildModel()
  private ci = 0

  color() {
    return COLORS[this.ci++ % COLORS.length]
  }

  node(p: Pt) {
    return this.m.findNodeNear(p[0], p[1], p[2]) as XYZ | null
  }

  at(p: Pt): XYZ {
    const n = this.node(p)
    if (!n) throw new Error(`module: no node at ${p.join(',')}`)
    return n
  }

  /** 一根 35 管，从 a 接到 b（跨距 40）。两头都没有接头时先在 a 落一个。 */
  link(a: Pt, b: Pt): XYZ {
    if (!this.node(a) && this.node(b)) return this.link(b, a)
    const from = this.node(a) ?? (this.m.addNode(a[0], a[1], a[2]) as XYZ)
    const exist = this.node(b)
    if (exist && this.m.tubeBetween(from.id, exist.id)) return exist
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const L = Math.hypot(d[0], d[1], d[2])
    if (Math.abs(L - SPAN) > 0.8) throw new Error(`module: span ${L.toFixed(1)} at ${a.join(',')} -> ${b.join(',')}`)
    const res = this.m.extend(from.id, d.map(v => v / L), 'T35', this.color(), 35, SPAN) as { node?: XYZ; duplicate?: boolean; collision?: boolean; ground?: boolean } | null
    if (!res?.node) throw new Error(`module: extend failed at ${a.join(',')} -> ${b.join(',')}`)
    return res.node
  }

  /** 一层水平网格里的所有横管；cells 给出要铺的格（其余格的边不接）。 */
  layer(y: number, cells: Cell[]) {
    const edges = new Map<string, [Pt, Pt]>()
    for (const [cx, cz] of cells) {
      const x0 = cx * SPAN, z0 = cz * SPAN
      const put = (a: Pt, b: Pt) => edges.set(`${a.join(',')}|${b.join(',')}`, [a, b])
      put([x0, y, z0], [x0 + SPAN, y, z0])
      put([x0, y, z0 + SPAN], [x0 + SPAN, y, z0 + SPAN])
      put([x0, y, z0], [x0, y, z0 + SPAN])
      put([x0 + SPAN, y, z0], [x0 + SPAN, y, z0 + SPAN])
    }
    const todo = [...edges.values()]
    let guard = 0
    while (todo.length) {
      const before = todo.length
      for (let i = todo.length - 1; i >= 0; i--) {
        const [a, b] = todo[i]
        if (this.node(a) || this.node(b)) { this.link(a, b); todo.splice(i, 1) }
      }
      if (todo.length === before) {
        // 这一层还没有任何接头：从第一条边起手
        const [a, b] = todo.pop()!
        this.link(a, b)
      }
      if (++guard > 500) throw new Error(`module: layer ${y} did not converge`)
    }
  }

  /** 立柱：给定格点从 y0 到 y1，每 40 一节。 */
  posts(y0: number, y1: number, spots: Cell[]) {
    for (const [cx, cz] of spots)
      for (let y = y0; y < y1; y += SPAN)
        this.link([cx * SPAN, y, cz * SPAN], [cx * SPAN, y + SPAN, cz * SPAN])
  }

  /** 一块 40×40 板，铺在格 (cx, cz) 的 y 高度上（两根平行的 x 向管之间）。 */
  deck(y: number, cx: number, cz: number) {
    const x0 = cx * SPAN, z0 = cz * SPAN
    this.panel([x0, y, z0], [x0 + SPAN, y, z0], [x0, y, z0 + SPAN], [x0 + SPAN, y, z0 + SPAN])
  }

  /** 一块 40×40 板，架在管 a–b 与管 c–d 之间。 */
  panel(a: Pt, b: Pt, c: Pt, d: Pt) {
    const t0 = this.m.tubeBetween(this.at(a).id, this.at(b).id)
    const t1 = this.m.tubeBetween(this.at(c).id, this.at(d).id)
    if (!t0 || !t1) throw new Error(`module: panel rails missing at ${a.join(',')}`)
    const def = getPanel('panel_40x40') as { w: number; h: number }
    const dims = [def.w, def.h]
    const partner = (this.m.panelPartners(t0.id, dims) as Array<{ id: string; lo: number }>).find(p => p.id === t1.id)
    if (!partner) throw new Error(`module: panel does not fit at ${a.join(',')}`)
    const sec = this.m.panelSection(partner, partner.lo + 0.05) as { t0: number; len: number }
    const added = this.m.addPanel(t0.id, t1.id, sec.t0, sec.len, 'panel_40x40', MODULE_PANEL_COLOR, 1)
    if (!added) throw new Error(`module: panel rejected at ${a.join(',')}`)
  }

  /** 两根共线的 35 管插 80 木芯。 */
  reinforce(a: Pt, b: Pt, c: Pt) {
    const t0 = this.m.tubeBetween(this.at(a).id, this.at(b).id)
    const t1 = this.m.tubeBetween(this.at(b).id, this.at(c).id)
    if (!t0 || !t1 || !this.m.addReinforcement([t0.id, t1.id])) throw new Error(`module: reinforcement failed at ${a.join(',')}`)
  }

  json(): EngineJson {
    return this.m.toJSON() as EngineJson
  }
}

function cellsOf(nx: number, nz: number): Cell[] {
  const out: Cell[] = []
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) out.push([x, z])
  return out
}

function spotsOf(nx: number, nz: number): Cell[] {
  const out: Cell[] = []
  for (let x = 0; x <= nx; x++) for (let z = 0; z <= nz; z++) out.push([x, z])
  return out
}

/** 护栏平台：2×2 站面，站面 y 高，四周护栏再高 40。 */
function packRailDeck(deckY: number): EngineJson {
  const f = new Frame()
  const cells = cellsOf(2, 2)
  const spots = spotsOf(2, 2)
  for (let y = 0; y <= deckY; y += SPAN) {
    f.layer(y, cells)
    if (y < deckY) f.posts(y, y + SPAN, spots)
  }
  for (const [cx, cz] of cells) f.deck(deckY, cx, cz)
  // 护栏：外圈立柱 + 顶上一圈横管；中间的柱子不要
  f.posts(deckY, deckY + SPAN, spots.filter(([x, z]) => x === 0 || x === 2 || z === 0 || z === 2))
  const top = deckY + SPAN
  for (let x = 0; x < 2; x++) {
    f.link([x * SPAN, top, 0], [(x + 1) * SPAN, top, 0])
    f.link([x * SPAN, top, 80], [(x + 1) * SPAN, top, 80])
  }
  for (let z = 0; z < 2; z++) {
    f.link([0, top, z * SPAN], [0, top, (z + 1) * SPAN])
    f.link([80, top, z * SPAN], [80, top, (z + 1) * SPAN])
  }
  return f.json()
}

/** 两级台阶：2×1，第一级 40，第二级 80。 */
function packSteps2(): EngineJson {
  const f = new Frame()
  f.layer(0, cellsOf(2, 1))
  f.posts(0, 40, spotsOf(2, 1))
  f.layer(40, cellsOf(2, 1))
  f.posts(40, 80, [[1, 0], [1, 1], [2, 0], [2, 1]])
  f.layer(80, [[1, 0]])
  f.deck(40, 0, 0)
  f.deck(80, 1, 0)
  return f.json()
}

/** 转角台阶：三级绕一个角上到 120，占 2×2 里的三格。 */
function packStepsL(): EngineJson {
  const f = new Frame()
  const a: Cell = [0, 0], b: Cell = [1, 0], c: Cell = [1, 1]
  const spotsAbc: Cell[] = spotsOf(2, 2).filter(([x, z]) => !(x === 0 && z === 2))
  const spotsBc: Cell[] = [[1, 0], [2, 0], [1, 1], [2, 1], [1, 2], [2, 2]]
  const spotsC: Cell[] = [[1, 1], [2, 1], [1, 2], [2, 2]]
  f.layer(0, [a, b, c])
  f.posts(0, 40, spotsAbc)
  f.layer(40, [a, b, c])
  f.posts(40, 80, spotsBc)
  f.layer(80, [b, c])
  f.posts(80, 120, spotsC)
  f.layer(120, [c])
  f.deck(40, ...a)
  f.deck(80, ...b)
  f.deck(120, ...c)
  return f.json()
}

/** 滑梯塔：1×1 两层，顶面铺板，一面挂一体滑梯，其余三面护栏。 */
function packSlideTower(): EngineJson {
  const f = new Frame()
  const cells = cellsOf(1, 1)
  const spots = spotsOf(1, 1)
  for (let y = 0; y <= 80; y += SPAN) {
    f.layer(y, cells)
    if (y < 80) f.posts(y, y + SPAN, spots)
  }
  f.deck(80, 0, 0)
  const mounts = f.m.slideMounts(40, 2, 'slide-new2') as Array<{ hook: number[]; normal: number[] }>
  const mount = mounts.find(m => m.normal[0] < -0.9)
  if (!mount) throw new Error('module: slide tower has no slide mount')
  if (!f.m.addSlide(mount.hook, mount.normal, 'slide-new2', 'green' as never)) throw new Error('module: slide rejected')
  f.posts(80, 120, spots)
  f.link([0, 120, 0], [40, 120, 0])
  f.link([0, 120, 40], [40, 120, 40])
  f.link([40, 120, 0], [40, 120, 40])
  return f.json()
}

/** 隧道屋：1×1×3 的隧道，两侧和顶上都铺板，两头敞开。 */
function packTunnelHouse(): EngineJson {
  const f = new Frame()
  const cells = cellsOf(1, 3)
  const spots = spotsOf(1, 3)
  f.layer(0, cells)
  f.posts(0, 40, spots)
  f.layer(40, cells)
  for (let z = 0; z < 3; z++) {
    f.deck(40, 0, z)
    for (const x of [0, 40]) {
      f.panel([x, 0, z * SPAN], [x, 0, (z + 1) * SPAN], [x, 40, z * SPAN], [x, 40, (z + 1) * SPAN])
    }
  }
  return f.json()
}

/** 双塔连桥：两座 1×1 双层塔，中间一格桥面，顶上整圈护栏。 */
function packBridgeTowers(): EngineJson {
  const f = new Frame()
  const towers: Cell[] = [[0, 0], [2, 0]]
  const all = cellsOf(3, 1)
  const spots = spotsOf(3, 1)
  f.layer(0, towers)
  f.posts(0, 40, spots)
  f.layer(40, towers)
  f.posts(40, 80, spots)
  f.layer(80, all)
  for (const [cx, cz] of all) f.deck(80, cx, cz)
  f.posts(80, 120, spots)
  f.layer(120, all)
  return f.json()
}

/**
 * 攀爬三角架：与官方顶棚同一副骨架（跨 100、脊 80、45° 斜角 + 35 管斜梁），
 * 不铺顶布，两侧各三根横档：檐口、半腰、屋脊。
 */
function packAFrame(): EngineJson {
  const f = new Frame()
  const m = f.m
  const S = Math.SQRT1_2
  const steps = 2
  const yEave = SPAN
  const width = 100
  const xMid = width / 2
  const yRidge = yEave + C45_ARM_LEN * S + 2 * SPAN * S
  const t35 = (a: XYZ, b: XYZ) => { m.addTube(a.id, b.id, 'T35', f.color(), 35) }

  const eaveAt = (x: number) => {
    const nodes: XYZ[] = []
    for (let i = 0; i <= steps; i++) nodes.push(m.addNode(x, yEave, i * SPAN) as XYZ)
    for (let i = 0; i < steps; i++) t35(nodes[i], nodes[i + 1])
    return nodes
  }
  const eaveL = eaveAt(0)
  const eaveR = eaveAt(width)
  for (const e of [eaveL[0], eaveL[steps], eaveR[0], eaveR[steps]]) {
    const foot = m.addNode(e.x, 0, e.z) as XYZ
    t35(foot, e)
  }
  const ridge: XYZ[] = []
  for (let i = 0; i <= steps; i++) ridge.push(m.addNode(xMid, yRidge, i * SPAN) as XYZ)
  for (let i = 0; i < steps; i++) t35(ridge[i], ridge[i + 1])

  type Ext = { node?: XYZ; ground?: boolean; collision?: boolean } | null
  const mids: Record<'L' | 'R', XYZ[]> = { L: [], R: [] }
  const gables: Array<{ side: 'L' | 'R'; corner: XYZ; axis: number[]; dir: number[] }> = [
    { side: 'L', corner: eaveL[0], axis: [-1, 0, 0], dir: [S, S, 0] },
    { side: 'L', corner: eaveL[steps], axis: [-1, 0, 0], dir: [S, S, 0] },
    { side: 'R', corner: eaveR[0], axis: [1, 0, 0], dir: [-S, S, 0] },
    { side: 'R', corner: eaveR[steps], axis: [1, 0, 0], dir: [-S, S, 0] },
  ]
  for (const g of gables) {
    const first = m.extendC45Diagonal(
      g.corner.id, g.dir, g.axis, 'T35', f.color(), 35, SPAN, C45_SLEEVE_LEN, C45_ARM_LEN,
    ) as Ext
    if (!first?.node) throw new Error('module: a-frame rafter failed')
    mids[g.side].push(first.node)
    const top = m.extendDiagonalSnap(first.node.id, g.dir, 'T35', f.color(), 35, SPAN) as Ext
    if (!top?.node) throw new Error('module: a-frame ridge failed')
  }
  // 半腰横档：两根斜梁的中点之间，80 cm，两根 35 管
  for (const side of ['L', 'R'] as const) {
    const [n0, n1] = mids[side]
    const a: Pt = [n0.x, n0.y, n0.z]
    const c: Pt = [n1.x, n1.y, n1.z]
    const b: Pt = [n0.x, n0.y, (n0.z + n1.z) / 2]
    f.link(a, b)
    f.link(b, c)
  }
  return f.json()
}

/** 秋千门架：两片 80 宽 120 高的端架，顶上一根横梁（插 80 木芯），地面两根拉杆。 */
function packSwingFrame(): EngineJson {
  const f = new Frame()
  for (const x of [0, 80]) {
    for (const z of [0, 80]) f.posts(0, 120, [[x / SPAN, z / SPAN]])
    for (let y = 0; y <= 120; y += SPAN) {
      f.link([x, y, 0], [x, y, 40])
      f.link([x, y, 40], [x, y, 80])
    }
  }
  f.link([0, 120, 40], [40, 120, 40])
  f.link([40, 120, 40], [80, 120, 40])
  f.reinforce([0, 120, 40], [40, 120, 40], [80, 120, 40])
  for (const z of [0, 80]) {
    f.link([0, 0, z], [40, 0, z])
    f.link([40, 0, z], [80, 0, z])
  }
  return f.json()
}

/** 沙坑框：XS 泳池衬（80×80，墙高 20）连框架一起。 */
function packSandbox(): EngineJson {
  const m = new BuildModel()
  let ci = 0
  const tubeFor = (span: number) => {
    let best: { id: string; length_cm: number } | null = null
    let bestD = Infinity
    for (const tb of buildableTubes() as Array<{ id: string; length_cm: number | null; shape?: string }>) {
      if (tb.length_cm == null || tb.shape === 'curved') continue
      const d = Math.abs(tb.length_cm - (span - 5))
      if (d < bestD) { bestD = d; best = { id: tb.id, length_cm: tb.length_cm } }
    }
    return best ? getTube(best.id) : null
  }
  // 引擎接受函数做颜色：框架逐根换色
  const opts = { color: () => COLORS[ci++ % COLORS.length], tubeFor } as never
  const frag = m.poolFragment(POOL_SETS.pool_liner_xs, opts) as { nodes: EngineJson['nodes']; tubes: EngineJson['tubes']; fittings: EngineJson['fittings'] } | null
  if (!frag) throw new Error('module: pool fragment failed')
  return { format: 2, nodes: frag.nodes, tubes: frag.tubes, fittings: frag.fittings }
}

/**
 * 人字顶棚：屋脊 80 或 160 cm。四角是普通接头，朝外插真正的 C45，
 * 再各用两根 35 管斜梁接到屋脊——和官方房子同一套接法。
 * 斜向跨度 100 cm（官方人字顶的屋距），两根 35 斜梁才能对上屋脊。
 */
function packRoof(kind: 'roof' | 'roof_large'): EngineJson {
  const m = new BuildModel()
  const ridgeLen = kind === 'roof_large' ? 160 : 80
  const steps = ridgeLen / SPAN
  const S = Math.SQRT1_2
  const yEave = SPAN
  const width = 100
  const xL = 0
  const xR = width
  const xMid = width / 2
  const yRidge = yEave + C45_ARM_LEN * S + 2 * SPAN * S
  let ci = 0
  const col = () => COLORS[ci++ % COLORS.length]
  const t35 = (a: XYZ, b: XYZ) => { m.addTube(a.id, b.id, 'T35', col(), 35) }

  const eaveAt = (x: number) => {
    const nodes: XYZ[] = []
    for (let i = 0; i <= steps; i++) nodes.push(m.addNode(x, yEave, i * SPAN) as XYZ)
    for (let i = 0; i < steps; i++) t35(nodes[i], nodes[i + 1])
    return nodes
  }
  const eaveL = eaveAt(xL)
  const eaveR = eaveAt(xR)
  for (const e of [eaveL[0], eaveL[steps], eaveR[0], eaveR[steps]]) {
    const foot = m.addNode(e.x, 0, e.z) as XYZ
    t35(foot, e)
  }

  const ridge: XYZ[] = []
  for (let i = 0; i <= steps; i++) ridge.push(m.addNode(xMid, yRidge, i * SPAN) as XYZ)
  for (let i = 0; i < steps; i++) t35(ridge[i], ridge[i + 1])

  type Ext = { node?: XYZ; ground?: boolean; collision?: boolean } | null
  const gables: Array<{ corner: XYZ; axis: number[]; dir: number[] }> = [
    { corner: eaveL[0], axis: [-1, 0, 0], dir: [S, S, 0] },
    { corner: eaveL[steps], axis: [-1, 0, 0], dir: [S, S, 0] },
    { corner: eaveR[0], axis: [1, 0, 0], dir: [-S, S, 0] },
    { corner: eaveR[steps], axis: [1, 0, 0], dir: [-S, S, 0] },
  ]
  for (const g of gables) {
    const first = m.extendC45Diagonal(
      g.corner.id, g.dir, g.axis, 'T35', col(), 35, SPAN, C45_SLEEVE_LEN, C45_ARM_LEN,
    ) as Ext
    if (!first?.node) continue
    m.extendDiagonalSnap(first.node.id, g.dir, 'T35', col(), 35, SPAN)
  }

  const qdf = kind === 'roof_large' ? 'roof-large2' : 'roof2'
  const mount = m.roofMounts(qdf)[0]
  if (mount) m.addRoofAt(mount, 'green' as never)
  return m.toJSON() as EngineJson
}

/** 几何起步造型 / 单体（立方框、长方、塔、桌、隧道、顶棚、游乐单元）。金字塔走 QDF。 */
export function geometricPreset(key: string): EngineJson | null {
  switch (key) {
    case 'cube': return packGrid(1, 1, 1)
    case 'box211': return packGrid(2, 1, 1)
    case 'box221': return packGrid(2, 2, 1)
    case 'box212': return packGrid(2, 1, 2)
    case 'tower': return packGrid(1, 2, 1)
    case 'table': return packGrid(2, 1, 1, 'table')
    case 'tunnel': return packGrid(1, 1, 3)
    case 'roof': return packRoof('roof')
    case 'roof_large': return packRoof('roof_large')
    case 'rail_deck': return packRailDeck(40)
    case 'rail_deck_tall': return packRailDeck(80)
    case 'steps2': return packSteps2()
    case 'steps_l': return packStepsL()
    case 'slide_tower': return packSlideTower()
    case 'tunnel_house': return packTunnelHouse()
    case 'bridge_towers': return packBridgeTowers()
    case 'a_frame': return packAFrame()
    case 'swing_frame': return packSwingFrame()
    case 'sandbox': return packSandbox()
    default: return null
  }
}

type FragPt = { id?: string; x: number; y: number; z: number; hook?: number[]; foot?: number[] }

/** 把几何 JSON 收成粘贴用的片段：坐标相对最小角，可插进现有设计。 */
export function jsonToFragment(data: EngineJson) {
  const nodes = data.nodes || []
  if (!nodes.length) return null
  const extras = [...(data.slides || []), ...(data.fittings || []), ...(data.clamps || [])] as FragPt[]
  const pts = [...nodes, ...extras]
  const anchor = [
    Math.min(...pts.map(n => n.x)),
    Math.min(...pts.map(n => n.y)),
    Math.min(...pts.map(n => n.z)),
  ]
  const rel = <T extends FragPt>(o: T) => ({ ...o, x: o.x - anchor[0], y: o.y - anchor[1], z: o.z - anchor[2] })
  const relPunkt = (p: number[] | undefined) => (
    Array.isArray(p) && p.length === 3
      ? [p[0] - anchor[0], p[1] - anchor[1], p[2] - anchor[2]]
      : p
  )
  return {
    anchor,
    nodes: nodes.map(rel),
    tubes: data.tubes || [],
    panels: data.panels || [],
    textiles: data.textiles || [],
    clamps: (data.clamps || []).map(c => rel(c as FragPt)),
    slides: (data.slides || []).map((s) => {
      const o = rel(s as FragPt)
      if (s.hook) o.hook = relPunkt(s.hook as number[])
      if (s.foot) o.foot = relPunkt(s.foot as number[])
      return o
    }),
    fittings: (data.fittings || []).map(f => rel(f as FragPt)),
  }
}
