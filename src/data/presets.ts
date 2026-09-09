import { BuildModel } from '../engine/model.js'
import { C45_SLEEVE_LEN, C45_ARM_LEN } from '../engine/config.js'

export interface PresetDef {
  key: string
  labelKey: string
  hint: string
  /** replace = 整表替换（金字塔）；place = 挂到指针上插入 */
  mode?: 'place' | 'replace'
}

/** 小单体：点一下跟指针走，放到现有造型上会合并去重。 */
export const MODULES: PresetDef[] = [
  { key: 'cube', labelKey: 'preset.cube', hint: '1×1×1' },
  { key: 'box211', labelKey: 'preset.box211', hint: '2×1×1' },
  { key: 'box221', labelKey: 'preset.box221', hint: '2×2×1' },
  { key: 'box212', labelKey: 'preset.box212', hint: '2×1×2' },
]

export const PRESETS: PresetDef[] = [
  { key: 'tower', labelKey: 'preset.tower', hint: '1×1×2' },
  { key: 'table', labelKey: 'preset.table', hint: '2×1' },
  { key: 'tunnel', labelKey: 'preset.tunnel', hint: '1×1×3' },
  { key: 'roof', labelKey: 'preset.roof', hint: '80 cm' },
  { key: 'roof_large', labelKey: 'preset.roof_large', hint: '160 cm' },
  { key: 'pyramid', labelKey: 'preset.pyramid', hint: 'A0128', mode: 'replace' },
]

export function presetThumbPath(key: string) {
  // 同 officialThumbPath：跟着产物走的资源要带 base
  return `${import.meta.env.BASE_URL}thumbs/presets/${key}.jpg?v=3`
}

const SPAN = 40
const COLORS = ['red', 'green', 'blue', 'yellow'] as const

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

/** 几何起步造型 / 单体（立方框、长方、塔、桌、隧道、顶棚）。金字塔走 QDF。 */
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
