import { Download } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { replenishmentRows } from './replenishment'
import PartThumbnail from './PartThumbnail'
import {openDownloads} from './Downloads'

export default function ReplenishmentList({ showRows = true }: { showRows?: boolean }) {
  const api = useEngine()
  const { t,lang } = useI18n()
  const missing = replenishmentRows(api.invRows, api.bom)
  if (api.feasible == null) return <p className="text-xs text-gray-500">{t('kit.noStock')}</p>
  return <section data-ui="replenishment-list" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold text-gray-300">{t('replenish.title')}</h2>
      {missing.length > 0 && <span className="text-[11px] text-gray-500 tabular-nums">{t('replenish.total', { kinds: missing.length, pcs: missing.reduce((sum, row) => sum + row.short, 0) })}</span>}
    </div>
    {missing.length ? <>
      {showRows && [false, true].map(soft => {
        const group = missing.filter(row => !!row.soft === soft)
        if (!group.length) return null
        return <div key={String(soft)} className="space-y-1">
          {soft && <p className="text-[11px] text-gray-500 pt-2">{t('replenish.optional')}</p>}
          {group.map(row => <div key={`${row.group}:${row.key}`} data-ui="replenishment-row" data-part-id={row.key} className="qb-material-row flex items-center gap-2">
            <PartThumbnail id={row.key} /><span className="qb-material-name text-gray-400 min-w-0 flex-1">{row.label}<span className="block text-[10px] text-gray-500 mt-0.5">{t('side.need')} {row.need} · {t('side.have')} {row.owned}</span></span><span className="qb-material-count text-amber-700 tabular-nums">×{row.short}</span>
          </div>)}
        </div>
      })}
      <button type="button" onClick={openDownloads} className="qb-btn qb-btn-ghost qb-btn-sm"><Download size={15} aria-hidden="true"/>{lang==='zh'?'下载资料':lang==='de'?'Dateien herunterladen':'Download files'}</button>
    </> : <p className="text-xs text-emerald-600">{t('replenish.enough')}</p>}
  </section>
}
