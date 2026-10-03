import { useMemo, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { kitsCovering, shortages, usedRows, vecFromBom, vecFromInventory, type AdvisorPart } from '../data/kitAdvice'
import { labelOf, skuLabel } from '../names'
import { useDock } from './dock'
import { formatKitPrice } from '../money'
import { track } from '../analytics/track'
import PartThumbnail from './PartThumbnail'

function advisorPartName(part: AdvisorPart) {
  const name = labelOf(part.id, part.name)
  return part.w && part.h && !name.includes('×') ? `${name} ${part.w}×${part.h} cm` : name
}

export default function KitAdvisor() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { setPane } = useDock()
  const [tab, setTab] = useState<'buy' | 'inv'>('buy')
  const mapped = useMemo(() => vecFromBom(api.bom), [api.bom])
  const stock = useMemo(() => vecFromInventory(api.inventory), [api.inventory])
  const buildable = useMemo(() => kitsCovering(mapped.used), [mapped.used])
  const missing = useMemo(() => shortages(mapped.used, stock.owned, mapped.parts), [mapped.used, stock.owned, mapped.parts])
  const rows = usedRows(mapped.used)
  const cheapest = buildable.find(k => k.price != null)
  const hasStock = api.feasible != null

  const copyList = () => {
    const lines = [t('kit.listTitle'), '', t('kit.used') + ':']
    rows.forEach(([i, v]) => lines.push(`  ${skuLabel(i)} ×${v}`))
    if (mapped.screws) lines.push(`  ${t('bom.screws')} ×${mapped.screws}`)
    if (mapped.unmapped.length) {
      lines.push('', t('kit.unmapped') + ':')
      mapped.unmapped.forEach(u => lines.push(`  ${labelOf(u.id, u.name)} ×${u.count}`))
    }
    lines.push('', t('kit.covers') + ':')
    if (!buildable.length) lines.push('  ' + t('kit.none'))
    else buildable.slice(0, 10).forEach((k, i) => {
      const price = k.price != null ? `  ${formatKitPrice(k.price, lang)}` : ''
      lines.push(`  ${i === 0 ? '★ ' : '  '}${k.disp}${price}`)
    })
    void navigator.clipboard?.writeText(lines.join('\n'))
    // 缺口有多大，是二手那边该收什么货的直接依据。只发数量，
    // 具体缺哪些件由 builder.part.pick 和存盘快照回答。
    track('builder.kit.copy', {
      kinds: rows.length,
      miss_kinds: missing.length,
      miss_qty: missing.reduce((a, m) => a + (Number(m.short) || 0), 0),
      kits: buildable.length,
    })
    api.notify(t('kit.copied'))
  }

  return (
    <div>
      <div className="sticky top-0 z-10 bg-gray-950/90 backdrop-blur px-3 py-2 border-b border-gray-800">
        <div className="flex gap-1 bg-gray-800/70 rounded-lg p-0.5">
          <button onClick={() => { track('builder.kit.tab', { tab: 'buy' }); setTab('buy') }} className={`flex-1 px-2 py-1.5 rounded-md text-xs cursor-pointer ${tab === 'buy' ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>{t('kit.buy')}</button>
          <button onClick={() => { track('builder.kit.tab', { tab: 'inv' }); setTab('inv') }} className={`flex-1 px-2 py-1.5 rounded-md text-xs cursor-pointer ${tab === 'inv' ? 'bg-teal-500 text-white font-semibold' : 'text-gray-300'}`}>{t('kit.stock')}</button>
        </div>
      </div>

      {mapped.total === 0 ? (
        <div className="p-4 text-sm text-gray-400">{t('kit.empty')}</div>
      ) : tab === 'buy' ? (
        <div className="p-3 space-y-4">
          <div>
            <div className="text-[11px] font-semibold text-gray-300 mb-2 uppercase tracking-wider">
              {t('kit.used')} <span className="text-gray-500 font-normal normal-case">{t('kit.usedN', { n: mapped.total })}</span>
            </div>
            <div className="space-y-1">
              {rows.map(([i, v]) => (
                <div key={i} data-ui="advisor-part-group" data-sku-index={i}>
                  {mapped.parts[i].length > 1 && <div className="flex justify-between text-[10px] text-gray-500 mt-2"><span>{skuLabel(i)}</span><span>×{v}</span></div>}
                  {mapped.parts[i].map(part => <div key={part.key} data-ui="advisor-part-row" data-part-id={part.id} className="qb-material-row flex items-center gap-2">
                    <PartThumbnail id={part.id} imageKey={part.key} />
                    <span className="qb-material-name text-gray-400 min-w-0 flex-1">{advisorPartName(part)}</span>
                    <span className="qb-material-count text-sky-700 tabular-nums">×{part.count}</span>
                  </div>)}
                </div>
              ))}
            </div>
            {mapped.screws > 0 && (
              <div className="mt-2 text-gray-500">
                {api.bom?.screws.map(row => <div key={row.key} data-ui="advisor-screw-row" data-part-id={row.id} className="qb-material-row flex items-center gap-2">
                  <PartThumbnail id={row.id} imageKey={row.key} kind="screws" />
                  <span className="qb-material-name flex-1 min-w-0">{labelOf(row.id || '', row.name)}</span>
                  <span className="qb-material-count tabular-nums">×{row.count}</span>
                </div>)}
                <p className="text-[10px] leading-relaxed mt-1">{t('kit.screws', { n: mapped.screws })}</p>
              </div>
            )}
            {mapped.unmapped.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <div className="text-[11px] text-amber-800 mb-1">{t('kit.unmapped')}</div>
                {mapped.unmapped.map(u => (
                  <div key={u.id} data-ui="advisor-unmapped-row" data-part-id={u.id} className="qb-material-row flex items-center gap-2 text-amber-900">
                    <PartThumbnail id={u.id} />
                    <span className="qb-material-name flex-1 min-w-0">{labelOf(u.id, u.name)}</span>
                    <span className="qb-material-count tabular-nums">×{u.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-300 mb-2 uppercase tracking-wider">{t('kit.covers')}</div>
            {!buildable.length ? (
              <div className="text-xs text-rose-700 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5">{t('kit.none')}</div>
            ) : (
              <div className="space-y-1.5">
                {buildable.slice(0, 12).map((k, idx) => (
                  <div key={k.name} className={`flex justify-between items-center gap-2 text-sm rounded-lg px-3 py-2 border ${idx === 0 ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-gray-800 bg-gray-800/40'}`}>
                    <span className="text-gray-100 min-w-0 truncate">{idx === 0 && <span className="text-emerald-400 mr-1">★</span>}{k.disp}</span>
                    <span className="text-teal-700 font-semibold tabular-nums shrink-0">{k.price != null ? formatKitPrice(k.price, lang) : t('kit.priceUnknown')}</span>
                  </div>
                ))}
              </div>
            )}
            {cheapest && <div className="mt-2.5 text-sm text-emerald-700">{t('kit.cheapest', { name: cheapest.disp, price: formatKitPrice(cheapest.price ?? 0, lang) })}</div>}
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={copyList} className="w-full bg-teal-500 hover:bg-teal-400 text-white font-semibold text-sm rounded-lg py-2.5 cursor-pointer">{t('kit.copy')}</button>
            <button onClick={() => setPane('bom')} className="w-full bg-gray-800 hover:bg-gray-700 text-sm rounded-lg py-2.5 cursor-pointer">{t('kit.continue')}</button>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {!hasStock ? (
            <div className="text-sm text-gray-400">{t('kit.noStock')}</div>
          ) : missing.length === 0 ? (
            <div className="text-sm text-emerald-600">{t('kit.stockOk')}</div>
          ) : (
            <div>
              <div className="text-sm text-amber-700 mb-2">{t('kit.stockShort')}</div>
              <div className="space-y-1">
                {missing.map(m => (
                  <div key={m.index} data-ui="advisor-shortage-group" data-sku-index={m.index}>
                    <div className="flex justify-between gap-2 text-[10px] text-gray-500 mt-2"><span>{m.parts.length === 1 ? advisorPartName(m.parts[0]) : m.name}</span><span className="qb-material-count text-amber-700 tabular-nums">−{m.short}</span></div>
                    {m.parts.map(part => <div key={part.key} data-ui="advisor-shortage-row" data-part-id={part.id} className="qb-material-row flex items-center gap-2">
                      <PartThumbnail id={part.id} imageKey={part.key} />
                      <span className="qb-material-name text-gray-400 min-w-0 flex-1">{advisorPartName(part)}<span className="block text-[10px] text-gray-500 mt-0.5">{t('side.need')} {part.count}</span></span>
                    </div>)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setPane('bom')} className="w-full bg-gray-800 hover:bg-gray-700 text-sm rounded-lg py-2.5 cursor-pointer">{t('kit.continue')}</button>
        </div>
      )}
    </div>
  )
}
