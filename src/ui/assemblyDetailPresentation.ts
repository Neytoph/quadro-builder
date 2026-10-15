type Operation = { id: string; order: number; instructions?: string[] }
type DetailGroup = { id: string; operationIds: string[]; viewDirection?: string | number[] }

export function operationLabel(order: number): string {
  return order >= 1 && order <= 20 ? String.fromCodePoint(0x2460 + order - 1) : `(${order})`
}

export function operationMarkGeometry(label: string) {
  const fontSize = label.length > 1 ? 13 : 18
  const width = label.length > 1 ? Math.max(26, label.length * 8 + 10) : 26
  return { width, fontSize, radius: Math.max(13, width / 2) }
}

// Keep presentation clearance separate from the engine's physical path. Both
// painters protect the projected shaft and arrowhead without moving either end.
export function operationCalloutOptions(arrows: { x1: number; y1: number; x2: number; y2: number }[], materialMarks: { x: number; y: number }[], blockedRects: { x: number; y: number; boxWidth: number; boxHeight: number }[] = []) {
  return { arrows, materialMarks, blockedRects, gap: 6, arrowClearance: 8, padding: 3 }
}

export function detailOperations(step: { operations?: Operation[] }, group?: DetailGroup | null): Operation[] {
  const selected = group ? new Set(group.operationIds) : null
  return (step.operations || []).filter(operation => !selected || selected.has(operation.id)).sort((a, b) => a.order - b.order)
}

export function detailViewName(viewDirection: DetailGroup['viewDirection']): 'front' | 'back' | 'bottom' | 'custom' {
  if (viewDirection === 'front' || viewDirection === 'back' || viewDirection === 'bottom') return viewDirection
  if (Array.isArray(viewDirection) && viewDirection.length === 3) {
    if (viewDirection[1] < 0) return 'bottom'
    return viewDirection[2] < 0 ? 'back' : 'front'
  }
  return viewDirection ? 'custom' : 'front'
}

export function activeDetail<T extends { id: string }>(groups: T[], id: string | null): T | null {
  return groups.find(group => group.id === id) || null
}
