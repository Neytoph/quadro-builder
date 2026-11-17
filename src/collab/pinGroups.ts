export type PinPosition = { id: string; x: number; y: number }
export type PinGroup = { ids: string[]; x: number; y: number }
export type PinObstacle = { left: number; top: number; right: number; bottom: number }

/** 合并屏幕上相碰的点击区。只调整标记的展示，不改三维锚点。 */
export function groupPins(points: PinPosition[], size = 48): PinGroup[] {
  const groups = points.map(point => ({ ids: [point.id], x: point.x, y: point.y }))
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j]
        if (Math.abs(a.x - b.x) >= size || Math.abs(a.y - b.y) >= size) continue
        const count = a.ids.length + b.ids.length
        a.x = (a.x * a.ids.length + b.x * b.ids.length) / count
        a.y = (a.y * a.ids.length + b.y * b.ids.length) / count
        a.ids.push(...b.ids)
        groups.splice(j, 1)
        merged = true
        break
      }
    }
  }
  return groups
}

/** 44px点击区避开工具和站点浮层，再合并移动后相碰的标记。 */
export function layoutPinGroups(points: PinPosition[], obstacles: PinObstacle[], bounds: { width: number; height: number; top: number }): PinGroup[] {
  const clampX = (x: number) => Math.max(22, Math.min(bounds.width - 22, x))
  const clampY = (y: number) => Math.max(bounds.top + 44, Math.min(bounds.height - 8, y))
  const free = (x: number, y: number) => obstacles.every(rect => x + 22 <= rect.left - 6 || x - 22 >= rect.right + 6 || y <= rect.top - 6 || y - 44 >= rect.bottom + 6)
  let groups = groupPins(points)
  while (groups.length) {
    for (const group of groups) {
      const x = clampX(group.x), y = clampY(group.y)
      if (free(x, y)) { group.x = x; group.y = y; continue }
      let best = { x, y, distance: Infinity }
      const xs = [x, 22, bounds.width - 22, ...obstacles.flatMap(rect => [clampX(rect.left - 30), clampX(rect.right + 30)])]
      const ys = [y, clampY(bounds.top + 44), bounds.height - 8, ...obstacles.flatMap(rect => [clampY(rect.top - 8), clampY(rect.bottom + 52)])]
      for (const px of xs) for (const py of ys) {
        const distance = (px - group.x) ** 2 + (py - group.y) ** 2
        if (distance < best.distance && free(px, py)) best = { x: px, y: py, distance }
      }
      group.x = best.x
      group.y = best.y
    }
    const merged = groupPins(groups.flatMap(group => group.ids.map(id => ({ id, x: group.x, y: group.y }))))
    if (merged.length === groups.length) return groups
    groups = merged
  }
  return groups
}
