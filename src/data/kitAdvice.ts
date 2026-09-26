import { KITS, PART_NAMES, type Kit } from './quadroKits'
import type { BomView, Inventory } from '../store/EngineContext'
import { skuLabel } from '../names'

export { KITS, PART_NAMES }
export type { Kit }

/** 引擎零件 id / QDF 种名 → 官方 50 维向量下标。对不上的件进 unmapped，不靠臂数猜。 */
const COL: Record<string, number> = {
  '5way': 0, '4way': 1, '3way': 2, cross: 3, t: 4, elbow: 5, straight: 6, diagonal: 7,
  T10: 8, T15: 9, T20: 10, T25: 11, T35: 12, TS5: 13, T75: 14, TC1: 15, TS7: 15,
  panel_40x40: 16, panel_40x20: 17, hole_panel_40x40: 18,
  textile: 19, textile_20x40: 19, lattice: 19, textile_round: 19, textil2: 19, lattice2: 19, 'textil-round2': 19,
  wheel: 20, 'multi-wheel2': 20,
  wheel_bearing: 21, bearing2: 21,
  hub_cap: 22, 'hub-cap2': 22,
  roof_large: 24, 'roof-large2': 24, roof: 24, roof2: 24,
  double_tube: 25,
  caster: 29, casters2: 29,
  wheel_adapter: 30, adapter2: 30,
  bag: 31, bag2: 31,
  slide_integral: 32, 'slide-new2': 32, slide_module: 32, slide2: 32,
  slide_end: 33, 'slide-end2': 33,
  slide_curved: 34, 'curved-slide2': 34,
  pool_liner_xs: 35, pool_liner_s: 35, 'pool-small2': 35,
  pool_liner_l: 36, pool2: 36,
  pool_liner_xxl: 37,
  wheel_floating: 38, 'floating-wheel2': 38,
  '6way': 40,
  bearing: 42, 'bearing-clamp': 42, 'bearing-connector4': 42,
  flexi: 46, flexi_hinge: 46, 'flexi-connector3': 46,
  flexi_bolt: 48, bolt2: 48,
  hole_t: 49, 'hole-connector4': 49,
}

function emptyVec() {
  return new Array(PART_NAMES.length).fill(0) as number[]
}

function bump(vec: number[], id: string, n: number, unmapped: { id: string; name: string; count: number }[], name: string) {
  if (!(n > 0)) return
  const col = COL[id]
  if (col == null) {
    unmapped.push({ id, name, count: n })
    return
  }
  vec[col] += n
}

export function vecFromBom(bom: BomView | null) {
  const used = emptyVec()
  const unmapped: { id: string; name: string; count: number }[] = []
  if (!bom) return { used, unmapped, total: 0, screws: 0 }
  for (const r of bom.tubes) bump(used, r.id || '', r.count, unmapped, r.name)
  for (const r of bom.connectors) bump(used, r.id || '', r.count, unmapped, r.name)
  for (const r of bom.panels) bump(used, r.id || '', r.count, unmapped, r.name)
  for (const r of bom.slides) bump(used, r.id || '', r.count, unmapped, r.name)
  for (const r of bom.wheels) bump(used, r.id || '', r.count, unmapped, r.name)
  for (const r of bom.textiles) bump(used, r.id || 'textile', r.count, unmapped, r.name)
  for (const r of bom.fittings) bump(used, r.id || '', r.count, unmapped, r.name)
  const total = used.reduce((s, n) => s + n, 0)
  const screws = bom.screws.reduce((s, r) => s + r.count, 0)
  return { used, unmapped, total, screws }
}

export function vecFromInventory(inv: Inventory) {
  const owned = emptyVec()
  const skip: { id: string; name: string; count: number }[] = []
  const addGroup = (group: Record<string, number>) => {
    for (const [id, n] of Object.entries(group)) bump(owned, id, n, skip, id)
  }
  addGroup(inv.tubes)
  addGroup(inv.connectors)
  addGroup(inv.panels)
  addGroup(inv.fittings)
  return { owned, skip }
}

export function kitsCovering(used: number[]) {
  const cols = used.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0)
  return KITS
    .filter(k => cols.every(i => (k.vec[i] ?? 0) >= used[i]))
    .sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))
}

export function shortages(used: number[], owned: number[]) {
  const missing: { name: string; short: number }[] = []
  used.forEach((v, i) => {
    if (v > (owned[i] || 0)) missing.push({ name: skuLabel(i), short: v - (owned[i] || 0) })
  })
  return missing
}

export function usedRows(used: number[]) {
  return used.map((v, i) => [i, v] as const).filter(([, v]) => v > 0)
}
