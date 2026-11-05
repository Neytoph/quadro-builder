import { useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { bridgeParams, BRIDGE_LIMITS } from '../engine/rainbowBridge.js'
import './BridgeSettings.css'

const COPY = {
  zh: { title: '彩虹桥', count: '管子个数', tubeLength: '管子长度', gap: '最小管间距', sag: '下垂量', first: '选择第一根管子', second: '选择第二根管子', cm: '厘米' },
  en: { title: 'Rainbow bridge', count: 'Tube count', tubeLength: 'Tube length', gap: 'Minimum gap', sag: 'Sag', first: 'Select the first tube', second: 'Select the second tube', cm: 'cm' },
  de: { title: 'Regenbogenbrücke', count: 'Rohranzahl', tubeLength: 'Rohrlänge', gap: 'Mindestabstand', sag: 'Durchhang', first: 'Erstes Rohr wählen', second: 'Zweites Rohr wählen', cm: 'cm' },
}

export default function BridgeSettings() {
  const api = useEngine()
  const { lang } = useI18n()
  const builder = api.engine()?.builder
  const target = builder?.bridgeTarget()
  const params = bridgeParams(target?.bridge || builder?.bridgeDefaults)
  const copy = COPY[lang]
  const [expanded, setExpanded] = useState(true)
  const change = (key: string, value: number) => { builder?.setBridgeParams({ [key]: value }); api.bump() }
  return <section className="qb-card qb-bridge-settings" aria-label={copy.title}>
    <button type="button" className="qb-bridge-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <strong>{copy.title}</strong>{!target && <span role="status">{builder?.panelRail ? copy.second : copy.first}</span>}
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {expanded && <div className="qb-bridge-fields">
      {(Object.keys(BRIDGE_LIMITS) as Array<keyof typeof BRIDGE_LIMITS>).map(key => <label key={key}>
        <span>{copy[key]}</span>
        <input key={`${target?.id || 'new'}:${params[key]}`} type="number" aria-label={copy[key]} min={BRIDGE_LIMITS[key][0]} max={BRIDGE_LIMITS[key][1]}
          step={key === 'count' ? 1 : 0.5} defaultValue={params[key]}
          onBlur={event => {
            if (event.currentTarget.value.trim() === '' || !event.currentTarget.validity.valid) { event.currentTarget.value = String(params[key]); return }
            const value = event.currentTarget.valueAsNumber
            if (Number.isFinite(value) && value !== params[key]) change(key, value)
          }}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(params[key]); event.currentTarget.blur() } }} />
        <span className="qb-bridge-unit">{key === 'count' ? '' : copy.cm}</span>
      </label>)}
    </div>}
  </section>
}
