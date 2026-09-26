// 一座造型的量：同步到账号、存成方案页时跟着造型一起送上去，托管版拿它当客观量
// （尺寸、手册步数、最高站立面、最大跨度、有没有围挡、没落地的零件组、安全审查的错误）。
// 口径全照引擎：尺寸同 model.bounds（四周各留半个接头），步数同分步手册（自下而上），
// 站立面、跨度、围挡同交付页的 computeMetrics，错误同安全检查面板。
import { BuildModel, computeBuildPlan, computeMetrics, computeSafety, geometry } from './engine-api'

export interface DesignStats {
  /** 宽、深、高，厘米 */
  size: [number, number, number]
  steps: number
  /** 最高站立面离地，厘米 */
  height: number
  /** 最大无支撑跨度，厘米 */
  span: number
  guard: boolean
  /** 没落地的零件组数 */
  floating: number
  /** 安全审查里「错误」那一级的规则 id */
  errors: string[]
}

interface Finding { rule: string; level: string; params: { n?: number } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statsOfModel(model: any): DesignStats {
  const b = model.bounds(geometry().connectorSize / 2) as { size: number[] } | null
  const safety = computeSafety(model) as { findings: Finding[] }
  const m = computeMetrics(model) as { maxDeckHeight: number; maxSpan: number; hasGuard: boolean }
  const errors = [...new Set(safety.findings.filter(f => f.level === 'error').map(f => f.rule))]
  return {
    size: b ? [Math.round(b.size[0]), Math.round(b.size[2]), Math.round(b.size[1])] : [0, 0, 0],
    steps: (computeBuildPlan(model, 'y+') as { steps: unknown[] }).steps.length,
    height: m.maxDeckHeight,
    span: m.maxSpan,
    guard: m.hasGuard,
    floating: safety.findings.find(f => f.rule === 'floating')?.params.n ?? 0,
    errors,
  }
}

/** 一份造型 JSON 的量；读不进引擎返回 null（和 partsOfData 一样）。 */
export function statsOfData(data: unknown): DesignStats | null {
  const model = new BuildModel()
  if (!model.loadJSON(data).ok) return null
  return statsOfModel(model)
}
