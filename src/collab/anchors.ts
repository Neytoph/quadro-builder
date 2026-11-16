import type { Anchor } from './api'

type P3 = [number, number, number]
type Part = { x?: number; y?: number; z?: number; a?: string; b?: string; geom?: { p?: P3 } }
type Model = Record<'nodes' | 'tubes' | 'panels' | 'textiles' | 'fittings' | 'slides' | 'clamps', Map<string, Part>>

const vector = (p: unknown): p is P3 => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
const middle = (a: P3, b: P3): P3 => a.map((n, i) => (n + b[i]) / 2) as P3

/** 配件参照点只用于计算位移，不受相机、房间背景和选择范围变化影响。 */
export function partAnchorPoint(model: Model, id: string): P3 | null {
  const node = (id: string): P3 | null => {
    const n = model.nodes.get(id), p = n && [n.x, n.y, n.z]
    return vector(p) ? p : null
  }
  const tube = (id: string): P3 | null => {
    const t = model.tubes.get(id), a = t?.a && node(t.a), b = t?.b && node(t.b)
    return a && b ? middle(a, b) : null
  }
  const n = node(id), t = tube(id)
  if (n || t) return n || t
  const p = model.panels.get(id) || model.textiles.get(id) || model.fittings.get(id) || model.slides.get(id) || model.clamps.get(id)
  if (!p) return null
  if (vector(p.geom?.p)) return p.geom.p
  const position = [p.x, p.y, p.z]
  if (vector(position)) return position
  const a = p.a && tube(p.a), b = p.b && tube(p.b)
  return a && b ? middle(a, b) : null
}

export function attachAnchor(model: Model, anchor: Anchor): Anchor {
  const point = anchor.partId && partAnchorPoint(model, anchor.partId)
  return point ? { ...anchor, partPoint: point } : anchor
}

export function anchorPoint(model: Model | null | undefined, anchor: Anchor): P3 {
  const current = model && anchor.partId && anchor.partPoint && partAnchorPoint(model, anchor.partId)
  return current ? anchor.point.map((n, i) => n + current[i] - anchor.partPoint![i]) as P3 : anchor.point
}
