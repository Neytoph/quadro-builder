import { describe, expect, it } from 'vitest'
import { asBom } from '../store/EngineContext'
import { shortages, vecFromBom } from '../data/kitAdvice'

describe('顾问按真实 BOM 身份展示图片', () => {
  it('共享算法列不合并不同零件，并只聚合相同身份的颜色', () => {
    const mapped = vecFromBom(asBom({
      tubes: [{ tubeId: 'TC1', color: 'red', count: 1 }, { tubeId: 'TS7', color: 'red', count: 2 }, { tubeId: 'TS7', color: 'blue', count: 3 }],
      fittings: [{ id: 'lattice', count: 1 }, { id: 'roof', count: 2 }, { id: 'roof_large', count: 3 }],
      textiles: [{ id: 'textile', w: 40, h: 40, count: 2 }, { id: 'textile_round', count: 3 }],
      slides: [{ id: 'slide_integral', count: 1 }, { id: 'slide_module', count: 2 }],
    }))
    expect(mapped.used[15]).toBe(6)
    expect(mapped.parts[15].map(part => [part.id, part.count])).toEqual([['TC1', 1], ['TS7', 5]])
    expect(mapped.used[19]).toBe(6)
    expect(mapped.parts[19].map(part => part.id).sort()).toEqual(['lattice', 'textile', 'textile_round'])
    expect(mapped.parts[24].map(part => part.id)).toEqual(['roof', 'roof_large'])
    expect(mapped.parts[32].map(part => part.id)).toEqual(['slide_integral', 'slide_module'])
    const owned = new Array(mapped.used.length).fill(0)
    owned[19] = 2
    const missing = shortages(mapped.used, owned, mapped.parts).find(row => row.index === 19)!
    expect(missing.short).toBe(4)
    expect(missing.parts).toEqual(mapped.parts[19])
    expect(missing.parts.every(part => !('short' in part))).toBe(true)
  })

  it('同一身份不同尺寸保留规格，零用量不展示', () => {
    const mapped = vecFromBom(asBom({ textiles: [
      { id: 'textile', w: 40, h: 40, color: 'red', count: 1 },
      { id: 'textile', w: 40, h: 80, color: 'red', count: 2 },
      { id: 'textile', w: 40, h: 40, color: 'blue', count: 3 },
      { id: 'lattice', count: 0 },
    ] }))
    expect(mapped.used[19]).toBe(6)
    expect(mapped.parts[19].map(part => [part.id, part.w, part.h, part.count])).toEqual([
      ['textile', 40, 40, 4], ['textile', 40, 80, 2],
    ])
    expect(vecFromBom(null).parts).toEqual({})
  })
})
