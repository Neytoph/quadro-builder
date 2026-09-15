import { useEffect, useMemo, useRef, useState } from 'react'
import { useEngine, type Inventory, type InvRow } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { labelOf } from '../names'
import { inventoryCatalog, INV_SECTIONS, INV_SECTION_TITLE, type InvCatalogItem, type InvGroup, type InvSection } from '../data/inventoryCatalog'
import { Svg16, partIcon } from './icons'
import { bumpCount, track } from '../analytics/track'

const COLOR_ONLY = new Set(['tubes', 'panels', 'screws'])

function RowIcon({ id, kind }: { id: string; kind: string }) {
  if (COLOR_ONLY.has(kind)) return null
  return (
    <span className="shrink-0 text-gray-300 inline-flex">
      <Svg16 inner={partIcon(id, kind)} size={16} />
    </span>
  )
}

function QtyField({
  value, onCommit, name, minus, plus,
}: {
  value: number
  onCommit: (n: number) => void
  name: string
  minus: string
  plus: string
}) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => { setTxt(String(value)) }, [value])
  const commit = (raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0))
    onCommit(n)
    setTxt(String(n))
  }
  return (
    <div className="flex items-stretch shrink-0">
      <button type="button" aria-label={`${minus} ${name}`}
        onClick={() => onCommit(Math.max(0, value - 1))}
        className="w-8 h-8 rounded-l-lg border border-gray-700 bg-gray-800 hover:border-teal-400 text-gray-300 text-sm cursor-pointer">−</button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={name}
        value={txt}
        onChange={e => setTxt(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => commit(txt)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-10 h-8 bg-gray-800 border-y border-gray-700 text-center text-xs text-gray-100 tabular-nums outline-none focus:border-teal-500"
      />
      <button type="button" aria-label={`${plus} ${name}`}
        onClick={() => onCommit(value + 1)}
        className="w-8 h-8 rounded-r-lg border border-gray-700 bg-gray-800 hover:border-teal-400 text-gray-300 text-sm cursor-pointer">+</button>
    </div>
  )
}

function extraItems(catalog: InvCatalogItem[], inv: Inventory, needRows: InvRow[]): InvCatalogItem[] {
  const seen = new Set(catalog.map(r => `${r.group}:${r.id}`))
  const extras: InvCatalogItem[] = []
  const push = (group: InvGroup, id: string, section: InvSection) => {
    const key = `${group}:${id}`
    if (!id || seen.has(key)) return
    seen.add(key)
    extras.push({ section, group, id })
  }
  for (const r of needRows) {
    const group = r.group as InvGroup
    const section = (['slides', 'wheels', 'textiles'].includes(r.group) ? r.group : group) as InvSection
    const mappedGroup: InvGroup = ['slides', 'wheels', 'textiles', 'fittings'].includes(r.group) ? 'fittings' : group
    if (mappedGroup in inv) push(mappedGroup, r.key, section)
  }
  for (const group of Object.keys(inv) as InvGroup[]) {
    const section = group as InvSection
    for (const id of Object.keys(inv[group] || {})) push(group, id, section)
  }
  return extras
}

type Filter = 'all' | 'owned' | 'short'

export default function InventoryPane() {
  const api = useEngine()
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const catalog = useMemo(() => {
    try { return inventoryCatalog() } catch { return [] }
  }, [api.ready])

  const needByKey = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of api.invRows) map.set(`${r.group}:${r.key}`, r.need)
    for (const r of api.invRows) {
      if (r.group === 'fittings' || r.group === 'slides' || r.group === 'wheels' || r.group === 'textiles') {
        map.set(`fittings:${r.key}`, r.need)
      }
    }
    return map
  }, [api.invRows])

  const rows = useMemo(() => {
    const all = [...catalog, ...extraItems(catalog, api.inventory, api.invRows)]
    const q = query.trim().toLowerCase()
    return all.filter(item => {
      const have = api.inventory[item.group]?.[item.id] ?? 0
      const need = needByKey.get(`${item.group}:${item.id}`)
        ?? needByKey.get(`${item.section}:${item.id}`)
        ?? 0
      if (filter === 'owned' && have <= 0) return false
      if (filter === 'short' && !(need > have)) return false
      if (!q) return true
      const name = labelOf(item.id).toLowerCase()
      return name.includes(q) || item.id.toLowerCase().includes(q)
    })
  }, [catalog, api.inventory, api.invRows, needByKey, query, filter])

  // 搜索打点：停手 600ms 才发一条，不然每敲一个字母就是一条。
  // 只发长度和有没有命中——搜索词是用户输入，按 track.ts 第 2 条规矩
  // 不进 props。"搜了但没结果"才是这里要看的信号：那说明件不在库里，
  // 或者名字跟用户嘴里叫的对不上。
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const id = setTimeout(() => track('builder.inventory.search', { len: q.length, hit: rows.length > 0 }), 600)
    return () => clearTimeout(id)
  }, [query, rows.length])

  // Inventory 是固定六个字段的接口而不是索引签名，Object.values 推不出元素类型，
  // 这里标一次，下面两个统计就都不用各标各的。
  const groups = Object.values(api.inventory) as Array<Record<string, number>>
  const kinds = groups.reduce((s, g) => s + Object.keys(g).length, 0)
  const pcs = groups.reduce((s, g) => s + Object.values(g).reduce((a, n) => a + n, 0), 0)
  const shortN = api.invRows.filter(r => !r.ok && !r.soft).length
  const hasStock = api.feasible != null

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('inv.filterAll') },
    { id: 'owned', label: t('inv.filterOwned') },
    { id: 'short', label: t('inv.filterShort') },
  ]

  return (
    <>
      <div className="px-3 py-2 text-xs border-b border-gray-800 space-y-1 shrink-0">
        {!hasStock
          ? <div className="text-gray-400">{t('side.noInventory')}</div>
          : (
            <div className={api.feasible ? 'text-emerald-300' : 'text-orange-400'}>
              {api.feasible ? t('side.feasible') : t('side.missing')}
              {shortN > 0 && !api.feasible ? ` · ${shortN}` : ''}
            </div>
          )}
        <div className="text-gray-500">{t('inv.ownedN', { kinds, pcs })}</div>
      </div>

      <div className="px-3 py-2 border-b border-gray-800 space-y-2">
        <p className="text-[11px] text-gray-500 leading-snug">{t('inv.hint')}</p>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('inv.search')}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 outline-none focus:border-teal-500"
        />
        <div className="flex gap-1 bg-gray-800/70 rounded-lg p-0.5">
          {filters.map(f => (
            <button key={f.id} type="button" onClick={() => { track('builder.inventory.filter', { id: f.id }); setFilter(f.id) }}
              className={`flex-1 px-2 py-1.5 rounded-md text-xs cursor-pointer ${filter === f.id ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={api.exportInventory}
            className="flex-1 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.invExport')}</button>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex-1 text-xs rounded-lg border border-gray-700 bg-gray-800 hover:border-teal-400 px-2 py-1.5 cursor-pointer">{t('btn.invImport')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={e => {
              const f = e.target.files?.[0]
              if (!f) return
              e.target.value = ''
              if (!window.confirm(t('confirm.importInv'))) return
              void api.importInventory(f)
            }} />
        </div>
      </div>

      <div className="p-3">
        {rows.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500 px-2 pb-1">
            <span className="flex-1" />
            <span className="w-8 text-right">{t('side.need')}</span>
            <span className="w-[6.5rem] text-center">{t('side.have')}</span>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="text-xs text-gray-500 leading-relaxed">
            {query ? t('inv.noMatch') : filter === 'owned' ? t('inv.noOwned') : filter === 'short' ? t('inv.noShort') : t('inv.noMatch')}
          </div>
        ) : INV_SECTIONS.map(section => {
          const items = rows.filter(r => r.section === section)
          if (!items.length) return null
          return (
            <div key={section} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{t(INV_SECTION_TITLE[section])}</div>
              <div className="flex flex-col">
                {items.map(item => {
                  const name = labelOf(item.id)
                  const have = api.inventory[item.group]?.[item.id] ?? 0
                  const need = needByKey.get(`${item.group}:${item.id}`)
                    ?? needByKey.get(`${item.section}:${item.id}`)
                    ?? 0
                  const short = need > have
                  return (
                    <div key={`${item.group}:${item.id}`}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1 ${short ? 'bg-orange-500/25' : ''}`}>
                      <RowIcon id={item.id} kind={item.section} />
                      <span className="flex-1 min-w-0 truncate text-xs text-gray-100" title={name}>{name}</span>
                      <span title={need ? `${t('side.need')} ${need}` : undefined}
                        className={`w-8 text-right tabular-nums text-[11px] shrink-0 ${need ? (short ? 'text-orange-400' : 'text-gray-500') : 'text-gray-700'}`}>
                        {need || '—'}
                      </span>
                      <QtyField
                        value={have}
                        name={`${name} ${t('side.have')}`}
                        minus={t('inv.minus')}
                        plus={t('inv.plus')}
                        onCommit={n => { bumpCount('builder.inventory.edit'); api.setInv(item.group, item.id, n) }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
