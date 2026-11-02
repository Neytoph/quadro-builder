import { geometry } from './engine/catalog.js'
import { computeAssemblyStepCount } from './engine/assemblyPlan.js'
import { computeSafety, computeMetrics } from './engine/safety.js'
import { withPlacementSnapshot } from './engine/incrementalPlacement.js'

export interface DesignStats {
  size: [number, number, number]
  steps: number
  height: number
  span: number
  guard: boolean
  floating: number
  errors: string[]
}
interface Finding { rule: string; level: string; params: { n?: number } }

// 与网页及服务端快照共用引擎计算，不依赖网页资源清单、DOM或浏览器存储。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statsOfModel(model: any): DesignStats {
  return withPlacementSnapshot(model,()=>computeStats(model))
}

function computeStats(model: any): DesignStats {
  const b = model.bounds(geometry().connectorSize / 2) as { size: number[] } | null
  const safety = computeSafety(model) as { findings: Finding[] }
  const m = computeMetrics(model) as { maxDeckHeight: number; maxSpan: number; hasGuard: boolean }
  return {
    size: b ? [Math.round(b.size[0]), Math.round(b.size[2]), Math.round(b.size[1])] : [0, 0, 0],
    steps: computeAssemblyStepCount(model, 'y+'),
    height: m.maxDeckHeight, span: m.maxSpan, guard: m.hasGuard,
    floating: safety.findings.find(f => f.rule === 'floating')?.params.n ?? 0,
    errors: [...new Set(safety.findings.filter(f => f.level === 'error').map(f => f.rule))],
  }
}
