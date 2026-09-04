import { useEngine, type BomRow } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { formatCatalogPrice } from '../money'
import { colorLabel, labelOf } from '../names'
import { colorHex } from '../engine-api'
import { Svg16, partIcon } from './icons'

const COLOR_ONLY = new Set(['tubes', 'panels', 'screws'])

function RowIcon({ id, kind }: { id?: string; kind?: string }) {
  if (kind && COLOR_ONLY.has(kind)) return null
  return (
    <span className="shrink-0 text-gray-300 inline-flex">
      <Svg16 inner={partIcon(id, kind)} size={16} />
    </span>
  )
}

function colorWord(color: string | null | undefined) {
  if (!color) return ''
  if (color.startsWith('#')) return color
  return colorLabel(color)
}

function rowLabel(r: BomRow) {
  let label = labelOf(r.id || '', r.name)
  if (r.kind === 'textiles' && r.w && r.h) {
    const size = `${r.w}×${r.h}`
    if (!label.includes('×')) label = label ? `${label} ${size} cm` : `${size} cm`
  }
  return label
}

function Section({ title, rows, onPick }: { title: string; rows: BomRow[]; onPick: (r: BomRow) => void }) {
  if (!rows.length) return null
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map(r => {
          const tint = colorWord(r.color)
          const base = rowLabel(r)
          const label = tint && base ? `${base} · ${tint}` : (base || tint)
          return (
            <button key={r.key} onClick={() => onPick(r)} title={label}
              aria-label={`${label} ×${r.count}`}
              className="flex items-center gap-2 w-full text-left text-xs rounded-lg px-2 py-1.5 hover:bg-gray-800 cursor-pointer">
              <RowIcon id={r.id} kind={r.kind} />
              {r.color ? <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: String(colorHex(r.color)) }} /> : null}
              <span className="flex-1 truncate">{label}</span>
              <span className="tabular-nums text-gray-300">×{r.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BomPane() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const bom = api.bom

  return (
    <>
      <div className="px-3 py-2 text-xs border-b border-gray-800 space-y-1 shrink-0">
        {api.sizeCm && (
          <div className="text-gray-300">{t('side.size')} {api.sizeCm[0]} × {api.sizeCm[1]} × {api.sizeCm[2]} cm</div>
        )}
        {api.room.visible && (api.roomOverflow.w > 0 || api.roomOverflow.d > 0 || api.roomOverflow.h > 0) && (
          <div className="text-[11px] text-amber-300 leading-snug">
            ⚠ {t('room.overflow')}: {[
              api.roomOverflow.w > 0 ? t('room.overW', { n: api.roomOverflow.w }) : '',
              api.roomOverflow.d > 0 ? t('room.overD', { n: api.roomOverflow.d }) : '',
              api.roomOverflow.h > 0 ? t('room.overH', { n: api.roomOverflow.h }) : '',
            ].filter(Boolean).join(' · ')}
          </div>
        )}
        {api.feasible == null
          ? <div className="text-gray-500">{t('side.noInventory')}</div>
          : (
            <div className={api.feasible ? 'text-emerald-300' : 'text-amber-300'}>
              {api.feasible ? t('side.feasible') : t('side.missing')}
            </div>
          )}
        {bom && <div className="text-gray-400">{t('side.price')} {formatCatalogPrice(bom.totals.price, lang)}</div>}
      </div>
      <div className="p-3">
        {!bom || bom.totals.tubes + bom.totals.connectors + bom.totals.panels + bom.totals.other === 0
          ? <div className="text-xs text-gray-500">{t('side.empty')}</div>
          : (
            <>
              <Section title={t('bom.tubes')} rows={bom.tubes} onPick={r => api.highlight(r.kind, r.id || '', r.color)} />
              <Section title={t('bom.connectors')} rows={bom.connectors} onPick={r => api.highlight(r.kind, r.id || '')} />
              <Section title={t('bom.panels')} rows={bom.panels} onPick={r => api.highlight(r.kind, r.id || '', r.color)} />
              <Section title={t('bom.slides')} rows={bom.slides} onPick={r => api.highlight(r.kind, r.id || '')} />
              <Section title={t('bom.wheels')} rows={bom.wheels} onPick={r => api.highlight('fittings', r.id || '')} />
              <Section title={t('bom.textiles')} rows={bom.textiles} onPick={r => api.highlight(r.kind, r.id || '', r.color)} />
              <Section title={t('bom.fittings')} rows={bom.fittings} onPick={r => api.highlight(r.kind, r.id || '')} />
              <Section title={t('bom.reinforcements')} rows={bom.reinforcements} onPick={r => api.highlight(r.kind, r.id || '')} />
              <Section title={t('bom.screws')} rows={bom.screws} onPick={r => api.highlight(r.kind, r.id || '', r.color)} />
            </>
          )}
      </div>
    </>
  )
}
