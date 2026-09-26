import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BuildModel } from './model.js'
import { loadCatalog, buildableTubes, panels, geometry, getPartById, textilePart } from './catalog.js'
import { computeBOM, neededParts, compareInventory } from './bom.js'
import { buildQDF } from './qdfexport.js'
import { parseQDF } from './qdfimport.js'
import { computeBuildPlan } from './buildplan.js'
import { coverItems, stepItems, collectPositions, stepFilter } from './assemblyManual.js'
import { setLang } from './i18n.js'
import { vecFromBom } from '../data/kitAdvice'
import { asBom } from '../store/EngineContext'
import { inventoryCatalog } from '../data/inventoryCatalog'
import { PART_ZH, PART_EN, PART_DE } from '../names'

type V = [number, number, number]
const SHORT = { along: 20, gap: 40 }

beforeAll(async () => { await loadCatalog(); setLang('zh') })

const opts = () => ({ tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })

// 竖立的方框：宽 w（沿 x，上下两根管），高 h（沿 y，左右两根管），左下角在 x0
function frame(m: BuildModel, x0: number, w: number, h: number) {
  const tube = (p: V, q: V, len: number) => {
    const a = m.addNode(...p), b = m.addNode(...q)
    const t = m.addTube(a.id, b.id, 'T' + len, 'blue', len)
    if (!t) throw new Error(`管子没放上 ${p} → ${q}`)
    return t
  }
  const bottom = tube([x0, 0, 0], [x0 + w, 0, 0], w - 5)
  const top = tube([x0, h, 0], [x0 + w, h, 0], w - 5)
  const left = tube([x0, 0, 0], [x0, h, 0], h - 5)
  const right = tube([x0 + w, 0, 0], [x0 + w, h, 0], h - 5)
  return { bottom, top, left, right }
}

const span = (m: BuildModel, tx: { a: string; b: string; len: number }) => m.textileSpan(tx)
const partOf = (m: BuildModel, tx: { a: string; b: string; len: number; variant?: string }) =>
  textilePart(m.textileSpan(tx), tx.variant)?.id

describe('短布面：目录和名字', () => {
  it('目录里有 textile_20x40，沿管 20、两管间距 40，导出成 textil2', () => {
    const def = getPartById('textile_20x40')
    expect(def.qdf).toBe('textil2')
    expect(def.rail).toEqual(SHORT)
  })
  it('三种语言都有名字', () => {
    expect(PART_ZH.textile_20x40).toBe('短布面 20×40')
    expect(PART_EN.textile_20x40).toBe('Short textile 20×40')
    expect(PART_DE.textile_20x40).toBe('Kurzes Textil 20×40')
  })
  it('库存页把它列在布件里', () => {
    const row = inventoryCatalog().find(r => r.id === 'textile_20x40')
    expect(row).toMatchObject({ section: 'textiles', group: 'fittings' })
  })
})

describe('短布面：放置规则', () => {
  it('20×40 框：两根 15 管相距 40，能配上，一段 20', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 40)
    const p = m.latticePartners(f.bottom.id, 1.5, SHORT)
    expect(p.map(x => x.id)).toEqual([f.top.id])
    expect(p[0].len).toBe(20)
    expect(p[0].gap).toBe(40)
    expect(m.railFittingMounts('textil2', SHORT)).toHaveLength(1)
  })
  it('20×40 框：竖着的两根 35 管只隔 20，配不上', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 40)
    expect(m.latticePartners(f.left.id, 1.5, SHORT)).toEqual([])
  })
  it('普通布面放不进 20×40 框', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 40)
    expect(m.latticePartners(f.bottom.id)).toEqual([])
    expect(m.latticePartners(f.left.id)).toEqual([])
    expect(m.railFittingMounts('textil2')).toHaveLength(0)
  })
  it('没有相距 40 的平行管（20×80 框）就放不上短布面', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 80)
    expect(m.latticePartners(f.bottom.id, 1.5, SHORT)).toEqual([])
    expect(m.latticePartners(f.left.id, 1.5, SHORT)).toEqual([])
    expect(m.railFittingMounts('textil2', SHORT)).toHaveLength(0)
  })
  it('40×80 框：两根 75 管相距 40，可以沿管放四段短布面', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 40, 80)
    const p = m.latticePartners(f.left.id, 1.5, SHORT)
    expect(p.map(x => x.id)).toEqual([f.right.id])
    expect(m.panelSection(p[0], 70)).toMatchObject({ t0: 60, len: 20, count: 4 })
    expect(m.latticePartners(f.bottom.id, 1.5, SHORT)).toEqual([])
  })
  it('40×40 框：短布面能放两段，普通布面一段，互相不叠', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 40, 40)
    const p = m.latticePartners(f.bottom.id, 1.5, SHORT).find(x => x.id === f.top.id)!
    expect(p.len).toBe(20)
    expect(m.sectionFree('textil2', f.bottom.id, f.top.id, 0, 20)).toBe(true)
    expect(m.sectionFree('textil2', f.bottom.id, f.top.id, 20, 20)).toBe(true)
    const s1 = m.addTextile(f.bottom.id, f.top.id, 0, 20, 'red')!
    expect(s1).toBeTruthy()
    // 同一段再放、或者普通布面盖上去，都不行
    expect(m.addTextile(f.bottom.id, f.top.id, 0, 20, 'red')).toBeNull()
    expect(m.sectionFree('textil2', f.bottom.id, f.top.id, 0, 40)).toBe(false)
    expect(m.addTextile(f.bottom.id, f.top.id, 0, 40, 'red')).toBeNull()
    // 另一半还空着
    expect(m.sectionFree('textil2', f.bottom.id, f.top.id, 20, 20)).toBe(true)
    expect(m.addTextile(f.bottom.id, f.top.id, 20, 20, 'red')).toBeTruthy()
    expect(m.railFittingMounts('textil2', SHORT)).toHaveLength(0)
  })
  it('放下后格子不再亮', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 40)
    m.addTextile(f.bottom.id, f.top.id, 0, 20, 'green')
    expect(m.railFittingMounts('textil2', SHORT)).toHaveLength(0)
  })
})

describe('短布面：按位置认零件', () => {
  it('沿管 20、间距 40 是短布面；40×80 是普通布面；彩虹带按变体', () => {
    const m = new BuildModel()
    const a = frame(m, 0, 20, 40)
    const b = frame(m, 100, 40, 80)
    const c = frame(m, 200, 20, 40)
    const s = m.addTextile(a.bottom.id, a.top.id, 0, 20, 'red')!
    const n = m.addTextile(b.bottom.id, b.top.id, 0, 40, 'red')!
    const r = Object.assign(m.addTextile(c.bottom.id, c.top.id, 0, 20, 'red')!, { variant: 'rainbow' })
    expect(span(m, s)).toEqual({ len: 20, gap: 40 })
    expect(partOf(m, s)).toBe('textile_20x40')
    expect(partOf(m, n)).toBe('textile')
    expect(partOf(m, r)).toBe('textile_rainbow')
  })
  it('存成 JSON 再读回还是短布面', () => {
    const m = new BuildModel()
    const f = frame(m, 0, 20, 40)
    m.addTextile(f.bottom.id, f.top.id, 0, 20, 'red')
    const back = new BuildModel()
    back.loadJSON(JSON.parse(JSON.stringify(m.toJSON())))
    const [tx] = back.textiles.values()
    expect(partOf(back, tx)).toBe('textile_20x40')
  })
})

describe('短布面：料表、库存、配套建议', () => {
  function scene() {
    const m = new BuildModel()
    const a = frame(m, 0, 20, 40)
    const b = frame(m, 100, 20, 40)
    const c = frame(m, 200, 40, 80)
    m.addTextile(a.bottom.id, a.top.id, 0, 20, 'red')
    m.addTextile(b.bottom.id, b.top.id, 0, 20, 'red')
    m.addTextile(c.bottom.id, c.top.id, 0, 40, 'red')
    return m
  }
  it('料表：短布面单独一行，同色两块合一行，名字不再重复尺寸', () => {
    const bom = computeBOM(scene())
    const short = bom.textiles.filter((r: { id: string }) => r.id === 'textile_20x40')
    expect(short).toHaveLength(1)
    expect(short[0]).toMatchObject({ count: 2, w: 20, h: 40, kind: 'textil2', color: 'red' })
    expect(short[0].name.match(/20/g)).toHaveLength(1)
    const plain = bom.textiles.filter((r: { id: string }) => r.id === 'textile')
    expect(plain).toHaveLength(1)
    expect(plain[0].count).toBe(1)
    expect(bom.totals.textiles).toBe(3)
  })
  it('库存对账：按零件 id 要两块短布面，缺了只标红不算做不成', () => {
    const bom = computeBOM(scene())
    expect(neededParts(bom).fittings.get('textile_20x40')).toBe(2)
    const inv = { tubes: {}, connectors: {}, panels: {}, reinforcements: {}, fittings: { textile_20x40: 1 }, screws: {} }
    const row = compareInventory(bom, inv).rows.find((r: { key: string }) => r.key === 'textile_20x40')
    expect(row).toMatchObject({ need: 2, owned: 1, ok: false, soft: true })
  })
  it('配套建议：短布面算进布件那一格', () => {
    const { used, unmapped } = vecFromBom(asBom(computeBOM(scene())))
    expect(used[19]).toBe(3)
    expect(unmapped.find(u => u.id === 'textile_20x40')).toBeUndefined()
  })
})

describe('短布面：拼装说明', () => {
  it('放布那一步列出短布面，封面料表的编号能在图上找到位置', () => {
    const m = new BuildModel()
    const a = frame(m, 0, 20, 40)
    const b = frame(m, 100, 40, 80)
    m.addTextile(a.bottom.id, a.top.id, 0, 20, 'green')
    m.addTextile(b.bottom.id, b.top.id, 0, 40, 'green')
    const plan = computeBuildPlan(m)
    const step = plan.steps.find((s: { textileIds?: string[] }) => (s.textileIds || []).length)
    const rows = stepItems(m, step)
    const short = rows.find((r: { id: string }) => r.id === 'textile_20x40')
    expect(short).toMatchObject({ kind: 'textiles', count: 1, name: '短布面 20×40' })
    expect(collectPositions(m, stepFilter(step)).get(short.key)).toHaveLength(1)
    const cover = coverItems(computeBOM(m)).find((r: { id: string }) => r.id === 'textile_20x40')
    expect(cover.key).toBe(short.key)
    expect(collectPositions(m, null).get(cover.key)).toHaveLength(1)
    const plain = coverItems(computeBOM(m)).find((r: { id: string }) => r.id === 'textile')
    expect(collectPositions(m, null).get(plain.key)).toHaveLength(1)
  })
})

describe('短布面：导出 .qdf 再读回', () => {
  it('写成 textil2 150 × 350，读回来还是短布面、承重管还是那两根 15 管', () => {
    const m = new BuildModel()
    frame(m, 0, 20, 40)
    const f = frame(m, 100, 40, 80)
    const s = [...m.tubes.values()].filter(t => t.tubeId === 'T15')
    m.addTextile(s[0].id, s[1].id, 0, 20, 'green')
    m.addTextile(f.bottom.id, f.top.id, 0, 40, 'green')
    const text = buildQDF(m).text
    const lines = text.split(/\r?\n/).filter(l => l.startsWith('textil2{'))
    expect(lines).toHaveLength(2)
    // 第一个尺寸是沿管长度，和原件一致（沿管 35、两管之间 75）
    expect(lines.some(l => /, 1, 150\., 0\., 350\., 0\., 0}$/.test(l))).toBe(true)
    expect(lines.some(l => /, 1, 350\., 0\., 750\., 0\., 0}$/.test(l))).toBe(true)
    const back = new BuildModel()
    back.loadJSON(parseQDF(text, opts()))
    const txs = [...back.textiles.values()]
    expect(txs.map(tx => partOf(back, tx)).sort()).toEqual(['textile', 'textile_20x40'])
    const short = txs.find(tx => partOf(back, tx) === 'textile_20x40')!
    expect(span(back, short)).toEqual({ len: 20, gap: 40 })
    expect(back.tubes.get(short.a)!.tubeId).toBe('T15')
    expect(back.tubes.get(short.b)!.tubeId).toBe('T15')
    const plain = txs.find(tx => partOf(back, tx) === 'textile')!
    expect(span(back, plain)).toEqual({ len: 40, gap: 80 })
  })
  it('官方造型的布照文件里的轴认承重管：A0029 的 350 × 750 都是沿管 40、间距 80', () => {
    const text = readFileSync(join(process.cwd(), 'public/qdf/A0029.qdf'), 'utf8')
    const m = new BuildModel()
    m.loadJSON(parseQDF(text, opts()))
    const spans = [...m.textiles.values()].map(tx => m.textileSpan(tx))
    expect(spans.length).toBeGreaterThan(0)
    for (const s of spans) expect(s).toEqual({ len: 40, gap: 80 })
  })
  it('A0112 的 180 × 750 沿管 20、间距 80，不是短布面', () => {
    const text = readFileSync(join(process.cwd(), 'public/qdf/A0112.qdf'), 'utf8')
    const m = new BuildModel()
    m.loadJSON(parseQDF(text, opts()))
    const narrow = [...m.textiles.values()].find(tx => m.textileSpan(tx)!.len === 20)!
    expect(m.textileSpan(narrow)).toEqual({ len: 20, gap: 80 })
    expect(partOf(m, narrow)).toBe('textile')
  })
})
