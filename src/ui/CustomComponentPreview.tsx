import type { ComponentFragment } from '../store/customComponents'

export default function CustomComponentPreview({ fragment }: { fragment: ComponentFragment }) {
  const parts = [...fragment.nodes, ...fragment.clamps, ...fragment.slides, ...fragment.fittings]
    .filter(p => [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n)))
  const points = parts.map(p => ({ id: p.id, x: (Number(p.x) - Number(p.z)) * 0.866, y: (Number(p.x) + Number(p.z)) * 0.35 - Number(p.y) }))
  const minX = Math.min(0, ...points.map(p => p.x)), maxX = Math.max(1, ...points.map(p => p.x))
  const minY = Math.min(0, ...points.map(p => p.y)), maxY = Math.max(1, ...points.map(p => p.y))
  const scale = 48 / Math.max(maxX - minX, maxY - minY)
  const coords = new Map(points.map(p => [p.id, { x: 32 + (p.x - (minX + maxX) / 2) * scale, y: 32 + (p.y - (minY + maxY) / 2) * scale }]))
  const colours: Record<string, string> = { red: '#ef4444', yellow: '#e9b80a', blue: '#2585d5', green: '#1fa85a' }
  return <svg viewBox="0 0 64 64" aria-hidden="true" className="qb-component-preview">
    {fragment.tubes.map(t => {
      const a = coords.get(t.a || ''), b = coords.get(t.b || '')
      return a && b ? <line key={t.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colours[t.color || ''] || '#ea580c'} strokeWidth="3.5" strokeLinecap="round" /> : null
    })}
    {points.map(p => { const c = coords.get(p.id)!; return <circle key={p.id} cx={c.x} cy={c.y} r="2.2" fill="#718275" /> })}
  </svg>
}
