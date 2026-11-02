import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { loadCatalog, reinforcementPart } from './catalog.js'
import { computeBOM, neededParts } from './bom.js'
import { computeBuildPlan } from './buildplan.js'
import { setLang } from './i18n.js'

beforeAll(async () => { await loadCatalog(); setLang('zh') })

// 隔离直线框架用于核对铝管尺寸与节点间距对应的物料数量。
function reinforcedLine(length: 35 | 75, segments: number) {
  const model = new BuildModel()
  let previous = model.addNode(0, 40, 0)
  for (let index = 1; index <= segments; index++) {
    const next = model.addNode(index * (length + 5), 40, 0)
    const tube = model.addTube(previous.id, next.id, `T${length}`, 'blue', length)
    if (!tube) throw new Error('加固测试框架无法安装直管')
    tube.reinforced = true
    previous = next
  }
  return model
}

describe('内置加固铝管尺寸与计数', () => {
  it.each([[75, 1, 1], [35, 2, 1], [75, 8, 8], [35, 16, 8]] as const)(
    '%i cm 管 × %i 的料表与搭建步骤需要 %i 根加固铝管', (length, segments, count) => {
      const model = reinforcedLine(length, segments)
      const bom = computeBOM(model)
      expect(bom.reinforcements).toHaveLength(1)
      expect(bom.reinforcements[0]).toMatchObject({
        id: 'reinforce80', len: 75, count, pieces: count, name: '内置加固铝管 75 cm',
      })
      expect(neededParts(bom).reinforcements.get('reinforce80')).toBe(count)
      const plan = computeBuildPlan(model)
      expect(plan.steps.flatMap((step: any) => step.reinforcements).reduce(
        (sum: number, row: any) => sum + row.count, 0)).toBe(count)
    },
  )

  it('目录记录铝材、75 cm 实长和80 cm节点间距', () => {
    expect(reinforcementPart()).toMatchObject({
      id: 'reinforce80', material: 'Aluminium', length_cm: 75, coverage_cm: 80,
    })
  })
})
