type Mark = { x: number; y: number; label: string }

/** Move labels apart while retaining the actual projected attachment point. */
export function layoutAssemblyMarks(marks: Mark[], width: number, height: number, { radius = 12, gap = 3 } = {}) {
  const placed: (Mark & { anchorX: number; anchorY: number })[] = []
  const padding = radius + 1
  const spacing = radius * 2 + gap
  const stride = radius + 2
  const clamp = (value: number, limit: number) => Math.max(padding, Math.min(Math.max(padding, limit - padding), value))
  for (const mark of marks) {
    let best = { x: clamp(mark.x, width), y: clamp(mark.y, height) }
    let bestScore = Infinity
    for (let ring = 0; ring <= 12; ring++) {
      const count = ring ? Math.max(8, ring * 8) : 1
      for (let angle = 0; angle < count; angle++) {
        const radians = angle / count * Math.PI * 2
        const candidate = { x: clamp(mark.x + Math.cos(radians) * ring * stride, width), y: clamp(mark.y + Math.sin(radians) * ring * stride, height) }
        const overlap = placed.reduce((sum, other) => sum + Math.max(0, spacing - Math.hypot(candidate.x - other.x, candidate.y - other.y)) ** 2, 0)
        const score = overlap * 1000 + Math.hypot(candidate.x - mark.x, candidate.y - mark.y)
        if (score < bestScore) { best = candidate; bestScore = score }
      }
      if (bestScore < ring * stride + 1) break
    }
    placed.push({ ...mark, ...best, anchorX: mark.x, anchorY: mark.y })
  }
  return placed
}
