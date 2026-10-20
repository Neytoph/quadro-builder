import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, getTube } from './catalog.js'
import { Builder } from './builder.js'
import { BuildModel, POOL_SETS } from './model.js'
import { computeBOM } from './bom.js'
import { CLASSIC_COLOR_IDS } from './colors.js'

beforeAll(() => loadCatalog())

const expected: Record<string, { count: number; ids: string[] }> = {
  pool_liner_xs: { count: 24, ids: ['T15', 'T35'] },
  pool_liner_s: { count: 21, ids: ['T15', 'T35', 'T75'] },
  pool_liner_l: { count: 30, ids: ['T35', 'T75'] },
  pool_liner_xxl: { count: 36, ids: ['T35', 'T75'] },
}

describe('泳池框架使用普通彩色管', () => {
  for (const [linerId, spec] of Object.entries(POOL_SETS)) {
    it(`${linerId}新建、配件清单和重新打开保持普通管`, () => {
      const model = new BuildModel(), builder = Object.create(Builder.prototype)
      Object.assign(builder, {
        model, onNotice() {},
        // 只隔离鼠标放置，生成、插入、料表和存档均走真实实现。
        startPaste(fragment: unknown) { model.insertFragment(fragment); return true },
      })
      expect(builder.startPool(linerId)).toBe('paste')
      const tubes = [...model.tubes.values()]
      expect(tubes).toHaveLength(expected[linerId].count)
      const ids = new Set(tubes.map(tube => tube.tubeId))
      expect([...ids].sort()).toEqual(expected[linerId].ids)
      for (const tube of tubes) {
        expect(getTube(tube.tubeId)?.material).not.toBe('aluminium')
        expect(CLASSIC_COLOR_IDS).toContain(tube.color)
        const a = model.nodes.get(tube.a)!, b = model.nodes.get(tube.b)!
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(tube.length + 5)
      }
      expect([...model.fittings.values()]).toEqual([expect.objectContaining({ kind: spec.kind, color: 'blue', w: spec.w, d: spec.d, h: spec.h })])
      const bom = computeBOM(model)
      expect(bom.tubes.reduce((sum: number, row: { count: number }) => sum + row.count, 0)).toBe(tubes.length)
      expect(bom.tubes.every((row: { tubeId: string }) => !row.tubeId.startsWith('TA'))).toBe(true)
      const reopened = new BuildModel()
      expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
      expect(reopened.toJSON()).toEqual(model.toJSON())
    })
  }
})
