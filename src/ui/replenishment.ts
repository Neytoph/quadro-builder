import type { BomView, InvRow } from '../store/EngineContext'
import { labelOf } from '../names'
import { csvCell } from './bomExport'

type T = (key: string, vars?: Record<string, string | number>) => string

// 沿用引擎按实际零件身份计算的库存差额，避免套餐映射将不同规格抵扣。
export function replenishmentRows(rows: InvRow[], bom?: BomView | null) {
  const sizedParts = bom ? [...bom.textiles, ...bom.fittings] : []
  return rows.filter(row => row.group !== 'screws' && row.need > row.owned)
    .map(row => {
      const name = labelOf(row.key, row.name)
      const sizes = [...new Set(sizedParts.filter(part => part.id === row.key && part.w && part.h)
        .map(part => `${part.w}×${part.h}`))]
      const label = sizes.length && !name.includes('×') ? `${name} ${sizes.join(' / ')} cm` : name
      return { ...row, label, short: row.need - row.owned }
    })
}

export function replenishmentText(rows: InvRow[], name: string, t: T, bom?: BomView | null) {
  const missing = replenishmentRows(rows, bom)
  const lines = [t('replenish.title'), `${t('bomx.design')}: ${name}`, '']
  for (const soft of [false, true]) {
    const group = missing.filter(row => !!row.soft === soft)
    if (!group.length) continue
    if (soft) lines.push(t('replenish.optional'))
    for (const row of group) lines.push(`${row.label} (${row.key}) ×${row.short}`)
    lines.push('')
  }
  if (!missing.length) lines.push(t('replenish.enough'), '')
  else lines.push(t('replenish.total', { kinds: missing.length, pcs: missing.reduce((sum, row) => sum + row.short, 0) }))
  lines.push(t('replenish.note'))
  return lines.join('\n')
}

export function replenishmentCsv(rows: InvRow[], name: string, t: T, bom?: BomView | null) {
  const missing = replenishmentRows(rows, bom)
  const records: (string | number)[][] = [[
    t('bomx.design'), t('bomx.col.section'), t('replenish.partId'), t('bomx.col.part'),
    t('side.need'), t('side.have'), t('bomx.col.short'), t('replenish.notes'),
  ]]
  for (const soft of [false, true]) {
    for (const row of missing.filter(row => !!row.soft === soft)) {
      records.push([name, soft ? t('replenish.optional') : t('side.missing'), row.key, row.label,
        row.need, row.owned, row.short, t('replenish.note')])
    }
  }
  // CSV 中的用户名称作为文字打开，避免电子表格把开头的 =、+ 等当成公式。
  const cell = (value: string | number) => csvCell(typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value)
  return '\uFEFF' + records.map(record => record.map(cell).join(',')).join('\r\n') + '\r\n'
}
