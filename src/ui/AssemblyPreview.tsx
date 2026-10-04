import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { BuildModel, SceneManager, colorName, partName, getPartById } from '../engine-api'
import { assemblyState, computeAssemblyPlan } from '../engine/assemblyPlan.js'
import { takeModelThumb, waitSceneReady } from '../engine/thumbShot.js'
import { renderedBounds, assemblyFocusBounds, assemblyFixingGroups, assemblyPresentationState } from '../engine/assemblyManual.js'
import { useEngine, type AssemblyConfig } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { assemblyStrings, assemblyDiagnosticText, assemblyPdfStrings } from './assemblyStrings'
import { UI_ESCAPE_EVENT } from './events'
import { layoutAssemblyMarks } from './assemblyOverlay'
import './AssemblyPreview.css'

// 引擎计划由 Vanilla JS 提供。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any
const GROUPS = ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'reinforcements'] as const

export default function AssemblyPreview() {
  const api = useEngine()
  const { lang, t } = useI18n()
  const s = assemblyStrings[lang]
  const preview = api.manualPreview
  const host = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const view = useRef<{ scene: E; model: E } | null>(null)
  const redraw = useRef<(() => void) | null>(null)
  const projectOverlay = useRef<() => void>(() => {})
  const [overlay, setOverlay] = useState<{ width: number; height: number; marks: E[]; arrows: E[] }>({ width: 1, height: 1, marks: [], arrows: [] })
  const [viewError, setViewError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [fixOffset, setFixOffset] = useState(0)
  const [whole, setWhole] = useState(false)
  const [action, setAction] = useState(true)
  const [marked, setMarked] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const open = !!preview && api.exportManualConfirm
  useEffect(() => setFixOffset(0), [index, preview?.plan])

  useEffect(() => {
    if (!open || !host.current) return
    const scene = new SceneManager(host.current)
    scene.setMotion(false)
    scene.setTheme(false)
    scene.setScene(false)
    scene.onCameraChange = () => projectOverlay.current()
    scene.releaseLoadGate()
    view.current = { scene, model: new BuildModel() }
    const resize = new ResizeObserver(() => redraw.current?.())
    resize.observe(host.current)
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const onEsc = () => api.cancelExportManual()
    window.addEventListener('keydown', trap)
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => { resize.disconnect(); window.removeEventListener('keydown', trap); window.removeEventListener(UI_ESCAPE_EVENT, onEsc); scene.dispose(); view.current = null; previousFocus?.focus() }
  }, [open, api.cancelExportManual])

  useEffect(() => {
    if (!preview || !view.current) return
    const v = view.current
    const result = v.model.loadJSON(preview.data)
    if (!result.ok) { console.error('Assembly preview failed', result); setViewError(`Assembly snapshot: ${result.reason}`); return }
    setViewError(null)
    setIndex(i => Math.min(i, Math.max(0, preview.plan.steps.length - 1)))
  }, [preview?.data])

  useEffect(() => {
    if (!preview || !view.current) return
    const v = view.current
    const draw = () => {
      let assembly: E = whole || marked.length ? null : assemblyState(preview.plan, index, { action })
      const fixings = assembly ? assemblyFixingGroups(preview.plan).filter((mark: E) => mark.stepId === preview.plan.steps[index]?.id).slice(fixOffset, fixOffset + 12) : []
      if (assembly && fixings.length) assembly.interfaceMarks = []
      if (assembly) {
        assembly.fixingMarks = fixings
        assembly = assemblyPresentationState(v.model, preview.plan, preview.plan.steps[index], assembly)
      }
      projectOverlay.current = () => {
        const width = host.current?.clientWidth || 1, height = host.current?.clientHeight || 1
        const marks = [], arrows = []
        for (const marker of assembly?.interfaceMarks || []) {
          const arrow = assembly?.arrows.find((a: E) => a.id === marker.id)
          const delta = assembly?.transforms.get(marker.nodeId)
          const detached = delta && marker.position.map((n: number, i: number) => n + delta[i])
          const positions = marker.positions || (arrow ? [arrow.from, arrow.to] : detached ? [marker.position, detached] : [marker.position])
          for (const position of positions.filter(Boolean)) {
            const point = v.scene.projectWorld([position])[0]
            if (point) marks.push({ x: point.u * width, y: point.v * height, label: `I${String(marker.id).split('-').at(-1)}` })
          }
        }
        for (const arrow of assembly?.arrows || []) {
          const [from, to] = v.scene.projectWorld([arrow.from, arrow.to])
          if (from && to) arrows.push({ x1: from.u * width, y1: from.v * height, x2: to.u * width, y2: to.v * height })
        }
        for (const marker of fixings) {
          const point = v.scene.projectWorld([marker.position])[0]
          if (point) marks.push({ x: point.u * width, y: point.v * height, label: marker.label })
        }
        setOverlay({ width, height, marks: layoutAssemblyMarks(marks, width, height), arrows })
      }
      const tints = marked.length ? new Map(marked.map(id => [id, '#dc603e'])) : null
      v.scene.renderModel(v.model, null, { assembly, tints, dimUntinted: !!marked.length })
      v.scene.onResize()
      const bounds = assembly ? assemblyFocusBounds(v.scene, v.model, preview.plan, preview.plan.steps[index], assembly) : renderedBounds(v.scene, v.model)
      if (bounds && assembly?.arrows.length) {
        for (const arrow of assembly.arrows) for (const point of [arrow.from, arrow.to]) for (let axis = 0; axis < 3; axis++) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis] - 5)
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis] + 5)
          bounds.size[axis] = bounds.max[axis] - bounds.min[axis]
        }
      }
      const direction = v.scene.camera.position.clone().sub(v.scene.controls.target).normalize() as Vector3
      v.scene._frameAlong(v.model, direction, { animate: false, bounds })
      projectOverlay.current()
      if (import.meta.env.DEV && host.current) host.current.dataset.frame = JSON.stringify({ bounds, camera: v.scene.cameraState(), size: v.scene._viewSize })
      v.scene.requestRender()
    }
    v.scene.onMeshesReady = draw
    redraw.current = draw
    draw()
  }, [preview?.plan, preview?.data, index, whole, action, marked, fixOffset])

  if (!open || !preview) return null
  const plan = preview.plan
  const config = preview.config
  const ordered = config.order.map(id => config.regions.find(r => r.id === id)!).filter(Boolean)
  const current = plan.steps[index]
  const currentFixings = assemblyFixingGroups(plan).filter((mark: E) => mark.stepId === current?.id)
  const stale = preview.tabId !== api.activeTabId || JSON.stringify(api.engine()?.model.toJSON()) !== preview.source
  const busy = !!api.exportingManual
  const update = (next: AssemblyConfig) => { api.updateManualConfig(next); setMarked([]) }
  const move = (i: number, by: number) => {
    const order = [...config.order]
    ;[order[i], order[i + by]] = [order[i + by], order[i]]
    update({ ...config, order })
  }
  const split = (id: string) => {
    const region = config.regions.find(r => r.id === id)!
    if (!chosen.length || chosen.length >= region.partIds.length) return
    const newId = `region-${crypto.randomUUID()}`
    const pos = config.order.indexOf(id)
    update({ version: 1, regions: [...config.regions.map(r => r.id === id ? { ...r, partIds: r.partIds.filter(p => !chosen.includes(p)) } : r), { id: newId, name: s.newRegion, partIds: [...chosen] }], order: [...config.order.slice(0, pos + 1), newId, ...config.order.slice(pos + 1)] })
    setChosen([]); setEditing(null)
  }
  const merge = (id: string, next: string) => {
    const a = config.regions.find(r => r.id === id)!, b = config.regions.find(r => r.id === next)!
    update({ version: 1, regions: config.regions.filter(r => r.id !== next).map(r => r.id === id ? { ...r, partIds: [...new Set([...a.partIds, ...b.partIds])] } : r), order: config.order.filter(r => r !== next) })
    setEditing(null); setChosen([])
  }
  const auto = () => {
    const m = new BuildModel()
    if (!m.loadJSON({ ...preview.data, assemblyConfig: undefined }).ok) throw new Error('assembly preview cannot load snapshot')
    const automatic = computeAssemblyPlan(m, {}, preview.order)
    update({ version: 1, regions: automatic.regions.map((r: E) => ({ id: r.id, name: r.name, partIds: [...r.partIds] })), order: automatic.regions.map((r: E) => r.id) })
  }
  const exportPdf = async () => {
    const v = view.current
    if (!v) return
    const camera = v.scene.cameraState()
    try {
      v.scene.onMeshesReady = () => {}
      v.scene.renderModel(v.model, null, {})
      if (!await waitSceneReady(v.scene)) throw new Error('Assembly cover meshes timed out')
      await document.fonts.ready
      const cover = await takeModelThumb(v.scene, v.model)
      await api.confirmExportManual(cover)
    } catch (error) {
      console.error('Assembly preview cover failed', error)
      api.notify(t('toast.manualFailed'), 'err')
    } finally {
      if (view.current === v) { v.scene.restoreCameraState(camera); if (redraw.current) { v.scene.onMeshesReady = redraw.current; redraw.current() } }
    }
  }
  const names = new Map<string, string>()
  for (const g of GROUPS) for (const row of plan.bom?.[g] || []) for (const id of row.instanceIds || []) names.set(id, row.name || row.id || id)
  const diagnosticText = (d: E) => assemblyDiagnosticText(lang, d.code, d.message)

  return <section ref={dialog} className="assembly-preview" role="dialog" aria-modal="true" aria-labelledby="assembly-preview-title" data-testid="assembly-preview">
    <header><div><h2 id="assembly-preview-title">{s.title}</h2><p>{s.subtitle}</p></div><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={api.cancelExportManual}>{s.close}</button></header>
    <div className="assembly-preview-body">
      <aside className="assembly-preview-sidebar">
        <h3>{s.regions} · {ordered.length}</h3>
        <div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={auto}>{s.auto}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy || api.readOnly || stale || !!preview.repair} onClick={() => api.saveManualConfig() ? api.notify(s.saved) : api.notify(s.failedApply, 'warn')}>{s.save}</button></div>
        <label className="assembly-small">{s.order}<select className="w-full mt-2 rounded-lg border p-2" value={preview.order} disabled={busy} onChange={e => api.updateManualOrder(e.target.value)}>{api.assemblyOrders.map(o => <option key={o} value={o}>{t({ 'y+': 'assembly.orderYp', 'x+': 'assembly.orderXp', 'x-': 'assembly.orderXm', 'z+': 'assembly.orderZp', 'z-': 'assembly.orderZm' }[o] || o)}</option>)}</select></label>
        {ordered.map((r, i) => <article className="assembly-region" data-testid="assembly-region" key={r.id}>
          <span className="assembly-region-label">{plan.regions.find((region: E) => region.id === r.id)?.label || String.fromCharCode(65 + i)}</span>
          <input type="text" aria-label={s.name} key={`${r.id}-${r.name}`} defaultValue={r.name} disabled={busy} onBlur={e => { const name = e.target.value.trim(); if (name && name !== r.name) update({ ...config, regions: config.regions.map(x => x.id === r.id ? { ...x, name } : x) }) }} />
          <div className="assembly-small">{r.partIds.length} {s.parts}</div>
          <div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-label={`${s.up} ${r.name}`} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-label={`${s.down} ${r.name}`} disabled={busy || i === ordered.length - 1} onClick={() => move(i, 1)}>↓</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={() => { setEditing(editing === r.id ? null : r.id); setChosen([]); setMarked(r.partIds) }}>{s.edit}</button></div>
          {editing === r.id && <><div className="assembly-parts-list">{r.partIds.map(id => <label key={id}><input type="checkbox" checked={chosen.includes(id)} onChange={e => setChosen(ids => e.target.checked ? [...ids, id] : ids.filter(p => p !== id))} /><span>{names.get(id) || id} <small>{id}</small></span></label>)}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy || !chosen.length || chosen.length === r.partIds.length} onClick={() => split(r.id)}>{s.split}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy || i === ordered.length - 1} onClick={() => merge(r.id, ordered[i + 1].id)}>{s.merge}</button></div></>}
        </article>)}
      </aside>
      <div className="assembly-preview-canvas">
        <div ref={host} className="assembly-preview-host" data-testid="assembly-preview-canvas" />
        <svg className="assembly-interface-overlay" viewBox={`0 0 ${overlay.width} ${overlay.height}`} aria-hidden="true" data-testid="assembly-interface-overlay">
          <defs><marker id="assembly-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="#ea580c" /></marker></defs>
          {overlay.arrows.map((a, i) => <line key={`a-${i}`} {...a} stroke="#ea580c" strokeWidth="3" markerEnd="url(#assembly-arrowhead)" />)}
          {overlay.marks.map((m, i) => <g key={`m-${i}`} transform={`translate(${m.x},${m.y})`}>
            <line x1="0" y1="0" x2={m.anchorX - m.x} y2={m.anchorY - m.y} stroke="#ea580c" strokeWidth="1" />
            <circle cx={m.anchorX - m.x} cy={m.anchorY - m.y} r="2" fill="#ea580c" />
            <circle r="12" fill="#fffaf3" stroke="#ea580c" strokeWidth="2" />
            <text textAnchor="middle" dominantBaseline="central" fill="#9a4113" fontSize="11" fontWeight="700">{m.label}</text>
          </g>)}
        </svg>
        {viewError && <p role="alert">{viewError}</p>}<div className="assembly-preview-canvas-hint">{s.rotate}</div>
      </div>
      <aside className="assembly-preview-sidebar">
        {stale && <p role="status">{s.stale}</p>}
        {api.readOnly && <p>{s.readonly}</p>}
        {preview.repair?.validation?.loadVerified === false && <p>{s.repairPhysical}</p>}
        {preview.repair && <div className="assembly-repair" data-testid="assembly-repair-preview"><h3>{s.repairTitle}</h3><p>{s.repairHint}</p>{preview.repair.changes.map((c: E, i: number) => <div className="assembly-repair-change" key={i}><strong>{c.action === 'remove' || c.type === 'remove' ? s.remove : s.change} · {c.catalogPartId ? partName(getPartById(c.catalogPartId)) || c.catalogPartId : names.get(c.tubeId) || c.tubeId || c.partId || c.nodeId}</strong><p>{c.before?.color && colorName(c.before.color)} · {c.tubeId || c.partId} · {c.before?.a} ↔ {c.before?.b}</p>{c.action === 'remove' && <p>{s.duplicatePort}</p>}<details><summary>{s.before} / {s.after}</summary><div className="assembly-small">{s.before}: {JSON.stringify(c.before)}<br />{s.after}: {JSON.stringify(c.after)}</div></details></div>)}{preview.repair.bomChanges?.map((row: E, i: number) => <div className="assembly-part-row" key={i}><span>{row.name || preview.repair.beforeBOM?.[row.group]?.find((r: E) => (r.key || r.type || r.id) === row.key)?.name || row.key || row.id}</span><b>{row.before} → {row.after}</b></div>)}{preview.repair.diagnostics?.map((d: E, i: number) => <p key={i}>{diagnosticText(d)}</p>)}<div className="assembly-preview-tools"><button data-testid="assembly-repair-apply" className="qb-btn qb-btn-sm" disabled={busy || api.readOnly || stale || !preview.repair.canApply} onClick={() => { if (!api.applyManualRepairs()) api.notify(s.failedApply, 'warn') }}>{s.apply}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={api.discardManualRepairs}>{s.discard}</button></div></div>}
        {plan.diagnostics.length > 0 && <><h3>{s.diagnostics}</h3>{!preview.repair && plan.diagnostics.some((d: E) => d.repairable) && <button className="qb-btn qb-btn-ghost qb-btn-sm mb-3" disabled={busy} onClick={() => api.reviewManualRepairs([...new Set<string>(plan.diagnostics.filter((d: E) => d.repairable).flatMap((d: E) => d.nodeIds || []))])}>{s.repair}</button>}{plan.diagnostics.map((d: E, i: number) => <div className="assembly-diagnostic" key={i} data-severity={d.severity}><strong>{diagnosticText(d)}</strong><div className="assembly-small">{[...(d.nodeIds || []), ...(d.partIds || [])].join(' · ')}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => { setMarked([...new Set<string>([...(d.nodeIds || []), ...(d.partIds || [])])]); setWhole(true) }}>{s.locate}</button></div></div>)}</>}
        <h3>{s.steps} · {plan.steps.length}</h3>
        {!whole && !marked.length && <p className="assembly-small">{assemblyPdfStrings[lang].contextHint}</p>}
        {currentFixings.length > 0 && <div className="assembly-preview-tools"><span className="assembly-small">{currentFixings[fixOffset]?.label}–{currentFixings[Math.min(fixOffset + 11, currentFixings.length - 1)]?.label} · {s.fixingPositions}</span><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={fixOffset === 0} onClick={() => setFixOffset(value => value - 12)}>←</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={fixOffset + 12 >= currentFixings.length} onClick={() => setFixOffset(value => value + 12)}>→</button></div>}
        <div className="assembly-preview-tools mb-3"><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-pressed={whole} onClick={() => { setWhole(v => !v); setMarked([]) }}>{s.all}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-pressed={action} onClick={() => { setAction(v => !v); setWhole(false); setMarked([]) }}>{s.action}</button></div>
        {plan.steps.map((step: E, i: number) => <button data-testid="assembly-step" className="assembly-step" key={step.id || i} aria-current={i === index} onClick={() => { setIndex(i); setWhole(false); setMarked([]) }}>{i + 1}. {step.title || `${ordered.find(r => r.id === step.regionId)?.name || step.regionId} · ${step.action?.type === 'attach' ? s.attach : step.action?.type === 'preassemble' ? s.preassemble : s.build}`}</button>)}
        {current && <div className="mt-3">{current.dependsOn?.length > 0 && <p>{s.dependencies}: {current.dependsOn.map((id: string) => { const at = plan.steps.findIndex((step: E) => step.id === id); return at >= 0 ? `${at + 1}. ${plan.steps[at].title}` : id }).join(' · ')}</p>}{GROUPS.map(g => (current.parts?.[g]?.length > 0 ? <div key={g}><h3 className="mt-3">{s[g]}</h3>{current.parts[g].map((r: E, i: number) => <div className="assembly-part-row" key={r.key || i}><span>{r.name || r.id || r.key}</span><b>× {r.count}</b></div>)}</div> : null))}</div>}
      </aside>
    </div>
    <footer className="assembly-preview-footer"><div><p>{plan.canExport ? s.ready : s.blocked}</p>{busy && <><progress value={api.exportingManual!.page} max={api.exportingManual!.total} /><span className="assembly-small">{s.exporting} · {api.exportingManual!.page}/{api.exportingManual!.total}</span></>}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index === 0 || busy} onClick={() => { setIndex(i => i - 1); setMarked([]); setWhole(false) }}>{s.previous}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index >= plan.steps.length - 1 || busy} onClick={() => { setIndex(i => i + 1); setMarked([]); setWhole(false) }}>{s.next}</button><button data-testid="assembly-export" className="qb-btn qb-btn-sm" disabled={!plan.canExport || busy || !!viewError} onClick={() => void exportPdf()}>{s.export}</button></div></footer>
  </section>
}
