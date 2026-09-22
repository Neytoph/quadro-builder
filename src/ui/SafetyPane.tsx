import { useEngine, type SafetyFinding, type SafetyLevel } from '../store/EngineContext'
import { useI18n } from '../i18n'

const LEVELS: SafetyLevel[] = ['error', 'warn', 'info']

const DOT: Record<SafetyLevel, string> = {
  error: 'bg-red-400',
  warn: 'bg-amber-300',
  info: 'bg-gray-500',
}

function idsOf(f: SafetyFinding): string[] {
  return [...(f.ids.nodes || []), ...(f.ids.tubes || []), ...(f.ids.panels || [])]
}

export default function SafetyPane() {
  const api = useEngine()
  const { t } = useI18n()
  const res = api.safety

  const text = (f: SafetyFinding) => {
    const p = f.params
    const vars: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string' || typeof v === 'number') vars[k] = v
    if (f.rule === 'fall_height') return t(`safety.fall_height.${String(p.band)}`, vars)
    if (f.rule === 'clear_zone') {
      const base = t('safety.clear_zone', vars)
      if (p.roomOk === true) return `${base} ${t('safety.clear_zone.roomOk')}`
      if (p.roomOk === false) return `${base} ${t('safety.clear_zone.roomNo')}`
      return base
    }
    return t(`safety.${f.rule}`, vars)
  }

  const ref = (f: SafetyFinding) => (f.ref === 'builder' ? t('safety.ref.builder') : t('safety.ref', { ref: f.ref }))

  if (!res || !res.findings.length) {
    return (
      <div className="p-3 text-xs text-gray-400">
        {t('safety.empty')}
      </div>
    )
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <p className="text-[11px] text-gray-500 leading-snug">{t('safety.hint')}</p>
      {LEVELS.map(level => {
        const rows = res.findings.filter(f => f.level === level)
        if (!rows.length) return null
        return (
          <div key={level}>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{t(`safety.group.${level}`)}</div>
            <div className="flex flex-col gap-0.5">
              {rows.map((f, i) => {
                const ids = idsOf(f)
                const key = `${f.rule}:${i}`
                const body = (
                  <>
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[level]}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-gray-100 leading-snug">{text(f)}</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5">{ref(f)}</span>
                    </span>
                  </>
                )
                return ids.length ? (
                  <button key={key} type="button" onClick={() => api.highlightIds(key, ids)}
                    className="flex items-start gap-2 w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-800 cursor-pointer">
                    {body}
                  </button>
                ) : (
                  <div key={key} className="flex items-start gap-2 w-full rounded-lg px-2 py-1.5">{body}</div>
                )
              })}
            </div>
          </div>
        )
      })}
      <p className="text-[11px] text-gray-500 leading-snug border-t border-gray-800 pt-2">{t('safety.footer')}</p>
    </div>
  )
}
