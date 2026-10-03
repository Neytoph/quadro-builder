import { describe, expect, it } from 'vitest'
import { asBom } from '../store/EngineContext'
import { bomToCsv } from './bomExport'
import { accessoryStrings } from './accessoryStrings'

describe('配件套装清单显示数据', () => {
  it('保留新版板与配件的固定件摘要及验证状态', () => {
    const bom = asBom({
      panels: [{ panelId: 'panel_40x40_busy', color: 'green', count: 1, kitContents: '每套含四角固定件', designAssumption: true, loadVerified: false }],
      fittings: [{ id: 'steering_wheel', kind: 'steering_wheel', count: 2, kitContents: '每套含两个卡箍', designAssumption: true, loadVerified: false }],
      totals: {},
    })
    expect(bom.panels[0]).toMatchObject({ kitContents: '每套含四角固定件', designAssumption: true, loadVerified: false })
    expect(bom.fittings[0]).toMatchObject({ count: 2, kitContents: '每套含两个卡箍', designAssumption: true, loadVerified: false })
    expect(bom.screws).toHaveLength(0)
    const csv = bomToCsv({ bom, name: '配件验收夹具', sizeCm: null, invRows: [], lang: 'zh', t: key => accessoryStrings.zh[key as keyof typeof accessoryStrings.zh] || key })
    expect(csv).toContain('每套含四角固定件')
    expect(csv).toContain('每套含两个卡箍')
    expect(csv).toContain('承载能力待实物验证')
  })

  it('旧板件不新增套装与承载声明', () => {
    const bom = asBom({ panels: [{ panelId: 'panel_40x40_busy', color: 'red', count: 1 }], totals: {} })
    expect(bom.panels[0].kitContents).toBe('')
    expect(bom.panels[0].designAssumption).toBe(false)
    expect(bom.panels[0].loadVerified).toBeUndefined()
  })

  it('固定经典绿在清单导出中显示自然颜色名称', () => {
    const bom = asBom({ panels: [{ panelId: 'panel_40x40_lego', color: '#2FCB5A', count: 1 }], totals: {} })
    const csv = bomToCsv({ bom, name: '经典绿验收', sizeCm: null, invRows: [], lang: 'zh', t: key => accessoryStrings.zh[key as keyof typeof accessoryStrings.zh] || key })
    expect(csv).toContain('经典绿')
    expect(csv).not.toContain('#2FCB5A')
  })

  it('保留新增布面及铝管的实际套装与未实测信息', () => {
    const bom = asBom({
      tubes: [{ tubeId: 'TA35', count: 1, kitContents: '原接头适配', designAssumption: true, loadVerified: false }],
      textiles: [{ id: 'textile_long', count: 1, w: 40, h: 80, kitContents: '连续套管边', designAssumption: true, loadVerified: false }], totals: {},
    })
    expect(bom.tubes[0]).toMatchObject({ kitContents: '原接头适配', designAssumption: true, loadVerified: false })
    expect(bom.textiles[0]).toMatchObject({ w: 40, h: 80, kitContents: '连续套管边', designAssumption: true, loadVerified: false })
  })
})
