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
  { key: 'pyramid', labelKey: 'preset.pyramid', hint: 'A0128', mode: 'replace' },
]

const SPAN = 40
const COLORS = ['red', 'green', 'blue', 'yellow'] as const

type EngineJson = {
  format: number
  nodes: Array<{ id: string; x: number; y: number; z: number }>
  tubes: Array<{ id: string; a: string; b: string; tubeId: string; color: string; length: number }>
}

function packGrid(nx: number, ny: number, nz: number, kind: 'box' | 'table' = 'box'): EngineJson {
  const nodes = new Map<string, { id: string; x: number; y: number; z: number }>()
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

/** 几何起步造型 / 单体（立方框、长方、塔、桌、隧道）。金字塔走 QDF。 */
export function geometricPreset(key: string): EngineJson | null {
  switch (key) {
    case 'cube': return packGrid(1, 1, 1)
    case 'box211': return packGrid(2, 1, 1)
    case 'box221': return packGrid(2, 2, 1)
    case 'box212': return packGrid(2, 1, 2)
    case 'tower': return packGrid(1, 2, 1)
    case 'table': return packGrid(2, 1, 1, 'table')
    case 'tunnel': return packGrid(1, 1, 3)
    default: return null
  }
}

type FragNode = { id: string; x: number; y: number; z: number }

/** 把几何 JSON 收成粘贴用的片段：坐标相对最小角，可插进现有设计。 */
export function jsonToFragment(data: EngineJson) {
  const nodes = data.nodes || []
  if (!nodes.length) return null
  const anchor = [
    Math.min(...nodes.map(n => n.x)),
    Math.min(...nodes.map(n => n.y)),
    Math.min(...nodes.map(n => n.z)),
  ]
  const rel = (o: FragNode) => ({ ...o, x: o.x - anchor[0], y: o.y - anchor[1], z: o.z - anchor[2] })
  return {
    anchor,
    nodes: nodes.map(rel),
    tubes: data.tubes || [],
    panels: [] as unknown[],
    textiles: [] as unknown[],
    clamps: [] as unknown[],
    slides: [] as unknown[],
    fittings: [] as unknown[],
  }
}
