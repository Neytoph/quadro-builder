import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { BuildModel, SceneManager, colorName, partName, getPartById } from '../engine-api'
import { assemblyState, assemblyDetailState, computeAssemblyPlan } from '../engine/assemblyPlan.js'
import { takeModelThumb, waitSceneReady } from '../engine/thumbShot.js'
import { renderedBounds, assemblyFocusBounds, assemblyPresentationState, assemblyDetailItems, assemblyDetailBounds, assemblyDetailDirection, manualPositionedItems, layoutManualCallouts, layoutOperationCallouts, projectedOperationArrowHead } from '../engine/assemblyManual.js'
import { useEngine, type AssemblyConfig } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { assemblyStrings, assemblyDiagnosticText, assemblyPdfStrings } from './assemblyStrings'
import { UI_ESCAPE_EVENT } from './events'
import { layoutAssemblyMarks } from './assemblyOverlay'
import { activeDetail, detailOperations, detailViewName, operationLabel, operationMarkGeometry, operationCalloutOptions } from './assemblyDetailPresentation'
import { partImageSrc } from './partImages'
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
  const [whole, setWhole] = useState(false)
  const [action, setAction] = useState(true)
  const [marked, setMarked] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [locationImage, setLocationImage] = useState<string | null>(null)
  const locationCache = useRef<{ plan: E; key: string; image: string } | null>(null)
  const cameraViewKey = useRef('')
  const open = !!preview && api.exportManualConfirm

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
    const onEsc = () => { if (dialog.current?.classList.contains('assembly-preview-expanded')) setExpanded(false); else api.cancelExportManual() }
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
    setDetailId(null)
    setExpanded(false)
    locationCache.current = null
  }, [preview?.data])

  useEffect(() => {
    if (!preview || !view.current) return
    const v = view.current
    const draw = () => {
      const step = preview.plan.steps[index]
      const detail: E = !whole && !marked.length ? activeDetail(step?.detailGroups || [], detailId) : null
      const state = (isAction: boolean) => detail ? assemblyDetailState(preview.plan, index, detail.id, { action: isAction }) : assemblyState(preview.plan, index, { action: isAction })
      let assembly: E = whole || marked.length ? null : state(action)
      if (assembly) {
        if (!detail) assembly = assemblyPresentationState(v.model, preview.plan, step, assembly)
      }
      const materials = detail ? assemblyDetailItems(v.model, preview.plan, step, detail) : []
      const viewKey = `${index}:${detail?.id || 'overview'}:${whole}:${marked.join(',')}`
      const direction = cameraViewKey.current !== viewKey && detail ? new Vector3(...assemblyDetailDirection(detail, step)).normalize() : v.scene.camera.position.clone().sub(v.scene.controls.target).normalize() as Vector3
      cameraViewKey.current = viewKey
      if (detail) {
        const key = `${index}:${detail.id}`
        if (locationCache.current?.plan !== preview.plan || locationCache.current?.key !== key) {
          const overview = assemblyState(preview.plan, index)
          const tints = new Map(detail.partIds.map((id: string) => [id, '#ea580c']))
          v.scene.renderModel(v.model, null, { assembly: overview, tints, dimUntinted: true })
          v.scene.onResize()
          v.scene._frameAlong(v.model, new Vector3(1, 0.7, 1).normalize(), { animate: false, bounds: renderedBounds(v.scene, v.model) })
          const image = v.scene.snapshot({ width: 300, height: 220, pixelRatio: 1, hideRoom: true })
          locationCache.current = { plan: preview.plan, key, image }
          setLocationImage(image)
        }
      } else setLocationImage(null)
      projectOverlay.current = () => {
        const width = host.current?.clientWidth || 1, height = host.current?.clientHeight || 1
        const marks = [], arrows = []
        for (const marker of detail ? [] : assembly?.interfaceMarks || []) {
          const arrow = assembly?.arrows.find((a: E) => a.id === marker.id)
          const delta = assembly?.transforms.get(marker.nodeId)
          const detached = delta && marker.position.map((n: number, i: number) => n + delta[i])
          const positions = marker.positions || (arrow ? [arrow.from, arrow.to] : detached ? [marker.position, detached] : [marker.position])
          for (const position of positions.filter(Boolean)) {
            const point = v.scene.projectWorld([position])[0]
            if (point) marks.push({ x: point.u * width, y: point.v * height, label: `I${String(marker.id).split('-').at(-1)}` })
          }
        }
        for (const item of manualPositionedItems(v.model, materials, assembly)) {
          const projected = v.scene.projectWorld(item.positions).filter((p: E) => p && p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)
          const point = projected[0]
          if (point) marks.push({ x: point.u * width, y: point.v * height, label: String(item.num), kind: 'material' })
        }
        for (const operation of detail ? assembly?.operationNumbers || [] : []) {
          const positions = manualPositionedItems(v.model, [{ instanceIds: operation.partIds, key: operation.id }], assembly)[0]?.positions || []
          const point = v.scene.projectWorld(positions).find((p: E) => p && p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)
          if (point) marks.push({ x: point.u * width, y: point.v * height, label: operationLabel(operation.order), kind: 'operation' })
        }
        for (const arrow of assembly?.arrows || []) {
          const [from, to] = v.scene.projectWorld([arrow.from, arrow.to])
          if (from && to) arrows.push({ x1: from.u * width, y1: from.v * height, x2: to.u * width, y2: to.v * height })
        }
        const materialMarks = marks.filter(mark => mark.kind === 'material')
        const placedMaterials = layoutManualCallouts(materialMarks, width, height, 12)
        const operationMarks = marks.filter(mark => mark.kind === 'operation').map(mark => ({ ...mark, boxWidth: operationMarkGeometry(mark.label).width, boxHeight: 26 }))
        const placedOperations = layoutOperationCallouts(operationMarks, width, height, operationCalloutOptions(arrows, placedMaterials))
        const interfaceMarks = layoutAssemblyMarks(marks.filter(mark => !mark.kind), width, height, { radius: 12 })
        setOverlay({ width, height, marks: [...placedMaterials, ...placedOperations, ...interfaceMarks], arrows })
      }
      const tints = marked.length ? new Map(marked.map(id => [id, '#dc603e'])) : null
      v.scene.renderModel(v.model, null, { assembly, tints, dimUntinted: !!marked.length })
      v.scene.onResize()
      const focus = (renderState: E) => detail ? assemblyDetailBounds(v.scene, v.model, preview.plan, step, renderState) : assemblyFocusBounds(v.scene, v.model, preview.plan, step, renderState)
      let bounds = assembly ? focus(assembly) : renderedBounds(v.scene, v.model)
      if (assembly && (detail || step?.action?.layer)) {
        const other = detail ? state(!action) : assemblyPresentationState(v.model, preview.plan, step, state(!action))
        v.scene.renderModel(v.model, null, { assembly: other })
        const otherBounds = focus(other)
        v.scene.renderModel(v.model, null, { assembly })
        const min = bounds.min.map((n: number, axis: number) => Math.min(n, otherBounds.min[axis]))
        const max = bounds.max.map((n: number, axis: number) => Math.max(n, otherBounds.max[axis]))
        bounds = { min, max, size: max.map((n: number, axis: number) => n - min[axis]) }
      }
      if (bounds && assembly?.arrows.length) {
        for (const arrow of assembly.arrows) for (const point of [arrow.from, arrow.to]) for (let axis = 0; axis < 3; axis++) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis] - 5)
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis] + 5)
          bounds.size[axis] = bounds.max[axis] - bounds.min[axis]
        }
      }
      v.scene._frameAlong(v.model, direction, { animate: false, bounds })
      projectOverlay.current()
      if (import.meta.env.DEV && host.current) host.current.dataset.frame = JSON.stringify({ bounds, camera: v.scene.cameraState(), size: v.scene._viewSize })
      v.scene.requestRender()
    }
    v.scene.onMeshesReady = () => { locationCache.current = null; draw() }
    redraw.current = draw
    draw()
  }, [preview?.plan, preview?.data, index, whole, action, marked, detailId, expanded])

  if (!open || !preview) return null
  const plan = preview.plan
  const config = preview.config
  const ordered = config.order.map(id => config.regions.find(r => r.id === id)!).filter(Boolean)
  const current = plan.steps[index]
  const details: E[] = current?.detailGroups || []
  const detail: E = !whole && !marked.length ? activeDetail(details, detailId) : null
  const detailIndex = detail ? details.findIndex(group => group.id === detail.id) : -1
  const materials: E[] = detail && view.current ? assemblyDetailItems(view.current.model, plan, current, detail) : []
  const operations = detail ? detailOperations(current || {}, detail) : []
  const operationInstructions = new Set(operations.flatMap(operation => operation.instructions || []))
  const notes: string[] = [...new Set<string>(detail ? (detail.instructions || []).filter((line: string) => !operationInstructions.has(line)) : current?.instructions || [])]
  const selectDetail = (id: string | null) => { setDetailId(id); setWhole(false); setMarked([]); setAction(true) }
  const selectStep = (i: number) => { setIndex(i); setDetailId(null); setWhole(false); setMarked([]); setAction(true) }
  const readInstructions = () => {
    setExpanded(false)
    requestAnimationFrame(() => dialog.current?.querySelector('[data-testid="assembly-instructions"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
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

  return <section ref={dialog} className={`assembly-preview${expanded ? ' assembly-preview-expanded' : ''}`} role="dialog" aria-modal="true" aria-labelledby="assembly-preview-title" data-testid="assembly-preview" data-entry-ready={api.entryReady} data-source-current={!stale}>
    <header><div><h2 id="assembly-preview-title">{s.title}</h2><p>{s.subtitle}</p></div><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={api.cancelExportManual}>{s.close}</button></header>
    <div className="assembly-preview-body" data-testid="assembly-reading-body">
      <aside className="assembly-preview-sidebar assembly-region-sidebar">
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
        <div className="assembly-view-toolbar"><div className="assembly-view-heading"><span className="assembly-small" data-testid="assembly-step-number">{index + 1} / {plan.steps.length} · {detail ? s.details : s.overview}</span><strong>{detail?.title || current?.title}</strong></div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-action-view" aria-pressed={action} disabled={busy} onClick={() => { setAction(true); setWhole(false); setMarked([]) }}>{s.actionView}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-complete-view" aria-pressed={!action} disabled={busy} onClick={() => { setAction(false); setWhole(false); setMarked([]) }}>{s.completedView}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-enlarge" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? s.shrink : s.enlarge}</button></div></div>
        <div className="assembly-drawing">
        <div ref={host} className="assembly-preview-host" data-testid="assembly-preview-canvas" />
        <svg className="assembly-interface-overlay" viewBox={`0 0 ${overlay.width} ${overlay.height}`} aria-hidden="true" data-testid="assembly-interface-overlay">
          {overlay.marks.map((m, i) => <g key={`leader-${i}`} transform={`translate(${m.x},${m.y})`}>
            <line x1="0" y1="0" x2={m.anchorX - m.x} y2={m.anchorY - m.y} stroke={m.kind === 'operation' ? '#1b7650' : '#ea580c'} strokeWidth="1" />
            <circle cx={m.anchorX - m.x} cy={m.anchorY - m.y} r="2" fill={m.kind === 'operation' ? '#1b7650' : '#ea580c'} />
          </g>)}
          {overlay.arrows.map((a, i) => {
            const head = projectedOperationArrowHead(a, 8)
            return head && <g key={`a-${i}`} data-testid="assembly-detail-arrow">
              <line {...a} stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
              <line {...a} stroke="#c2410c" strokeWidth="2.5" strokeLinecap="round" />
              <polygon points={[head.tip, head.left, head.right].map(point => point.join(',')).join(' ')} fill="#c2410c" stroke="#fff" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke" />
            </g>
          })}
          {overlay.marks.map((m, i) => <g key={`m-${i}`} transform={`translate(${m.x},${m.y})`} data-mark-kind={m.kind || 'interface'} data-placement-clear={m.kind === 'operation' ? m.placementClear : undefined} data-testid={m.kind === 'material' ? 'assembly-detail-material' : m.kind === 'operation' ? 'assembly-detail-operation' : undefined}>
            {m.kind === 'operation' ? <rect x={-operationMarkGeometry(m.label).width / 2} y="-13" width={operationMarkGeometry(m.label).width} height="26" rx="5" fill="#edf6ec" stroke="#1b7650" strokeWidth="1.5" /> : <circle r="12" fill="#fffaf3" stroke="#ea580c" strokeWidth="2" />}
            <text textAnchor="middle" dominantBaseline="central" fill={m.kind === 'operation' ? '#176441' : '#9a4113'} fontSize={m.kind === 'operation' ? operationMarkGeometry(m.label).fontSize : 11} fontWeight="700">{m.label}</text>
          </g>)}
        </svg>
        {viewError && <p role="alert">{viewError}</p>}
        </div>
        <div className="assembly-view-caption"><div><strong data-testid="assembly-view-direction">{detail ? s[detailViewName(assemblyDetailDirection(detail, current))] : s.overview}</strong><p>{s.rotate}</p>{detail && <p>{s.materialLegend} · {s.operationLegend}</p>}</div>{detail && locationImage && <figure className="assembly-location" data-testid="assembly-detail-location"><img src={locationImage} alt={s.location} /><figcaption>{s.location}</figcaption></figure>}</div>
        {details.length > 0 && <nav className="assembly-detail-navigation" aria-label={s.details}><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-overview" aria-current={!detail ? 'true' : undefined} onClick={() => selectDetail(null)}>{s.overview}</button>{details.map((group: E, i: number) => <button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-detail" key={group.id} aria-current={detail?.id === group.id ? 'true' : undefined} onClick={() => selectDetail(group.id)}>{i + 1}. {group.title}</button>)}</nav>}
        <div className="assembly-detail-paging">{detail && <><span>{detailIndex + 1} / {details.length}</span><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={detailIndex === 0} onClick={() => selectDetail(details[detailIndex - 1].id)}>{s.detailPrevious}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={detailIndex === details.length - 1} onClick={() => selectDetail(details[detailIndex + 1].id)}>{s.detailNext}</button></>}<button className="qb-btn qb-btn-ghost qb-btn-sm assembly-read-instructions" data-testid="assembly-read-instructions" onClick={readInstructions}>{s.readInstructions}</button></div>
      </div>
      <aside className="assembly-preview-sidebar assembly-reading-sidebar">
        {stale && <p role="status">{s.stale}</p>}
        {api.readOnly && <p>{s.readonly}</p>}
        {preview.repair?.validation?.loadVerified === false && <p>{s.repairPhysical}</p>}
        {preview.repair && <div className="assembly-repair" data-testid="assembly-repair-preview"><h3>{s.repairTitle}</h3><p>{s.repairHint}</p>{preview.repair.changes.map((c: E, i: number) => <div className="assembly-repair-change" key={i}><strong>{c.action === 'remove' || c.type === 'remove' ? s.remove : s.change} · {c.catalogPartId ? partName(getPartById(c.catalogPartId)) || c.catalogPartId : names.get(c.tubeId) || c.tubeId || c.partId || c.nodeId}</strong><p>{c.before?.color && colorName(c.before.color)} · {c.tubeId || c.partId} · {c.before?.a} ↔ {c.before?.b}</p>{c.action === 'remove' && <p>{s.duplicatePort}</p>}<details><summary>{s.before} / {s.after}</summary><div className="assembly-small">{s.before}: {JSON.stringify(c.before)}<br />{s.after}: {JSON.stringify(c.after)}</div></details></div>)}{preview.repair.bomChanges?.map((row: E, i: number) => <div className="assembly-part-row" key={i}><span>{row.name || preview.repair.beforeBOM?.[row.group]?.find((r: E) => (r.key || r.type || r.id) === row.key)?.name || row.key || row.id}</span><b>{row.before} → {row.after}</b></div>)}{preview.repair.diagnostics?.map((d: E, i: number) => <p key={i}>{diagnosticText(d)}</p>)}<div className="assembly-preview-tools"><button data-testid="assembly-repair-apply" className="qb-btn qb-btn-sm" disabled={busy || api.readOnly || stale || !preview.repair.canApply} onClick={() => { if (!api.applyManualRepairs()) api.notify(s.failedApply, 'warn') }}>{s.apply}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={api.discardManualRepairs}>{s.discard}</button></div></div>}
        {plan.diagnostics.length > 0 && <><h3>{s.diagnostics}</h3>{!preview.repair && plan.diagnostics.some((d: E) => d.repairable) && <button className="qb-btn qb-btn-ghost qb-btn-sm mb-3" disabled={busy} onClick={() => api.reviewManualRepairs([...new Set<string>(plan.diagnostics.filter((d: E) => d.repairable).flatMap((d: E) => d.nodeIds || []))])}>{s.repair}</button>}{plan.diagnostics.map((d: E, i: number) => <div className="assembly-diagnostic" key={i} data-severity={d.severity}><strong>{diagnosticText(d)}</strong><div className="assembly-small">{[...(d.nodeIds || []), ...(d.partIds || [])].join(' · ')}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => { setMarked([...new Set<string>([...(d.nodeIds || []), ...(d.partIds || [])])]); setWhole(true) }}>{s.locate}</button></div></div>)}</>}
        <h3>{s.steps} · {plan.steps.length}</h3>
        <p className="assembly-safety">{s.safetyNotice}</p>
        {details.length > 0 && <p>{s.detailHint}</p>}
        {!whole && !marked.length && <p className="assembly-small">{current?.action?.layer ? assemblyPdfStrings[lang].layerHint : ['frame', 'risers', 'panels'].includes(current?.kind) ? assemblyPdfStrings[lang].bodyHint : current?.action?.scope === 'parts' && current.action.type === 'preassemble' ? s.preassemblyHint : assemblyPdfStrings[lang].contextHint}</p>}
        <div className="assembly-preview-tools mb-3"><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-pressed={whole} onClick={() => { setWhole(v => !v); setMarked([]) }}>{s.all}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-pressed={action} onClick={() => { setAction(v => !v); setWhole(false); setMarked([]) }}>{s.action}</button></div>
        {current && <div className="assembly-current-instructions" data-testid="assembly-instructions"><h3>{detail?.title || s.instructions}</h3>{notes.map((line: string, i: number) => <p key={i}>{line}</p>)}{operations.length > 0 && <><h3>{s.operations}</h3><ol className="assembly-operations">{operations.map(operation => <li key={operation.id}><strong>{operationLabel(operation.order)}</strong><div>{(operation.instructions || []).map((line, i) => <p key={i}>{line}</p>)}</div></li>)}</ol></>}{detail && <><h3>{s.materials}</h3><p className="assembly-small">{assemblyPdfStrings[lang].detailReference}</p><ul className="assembly-detail-materials">{materials.map((item: E) => <li key={item.key}><span className="assembly-material-number">{item.num}</span>{partImageSrc(item.id) && <img src={partImageSrc(item.id)!} alt="" />}<span>{item.name}{item.colorName && <small>{item.colorName}</small>}</span></li>)}</ul></>}{!detail && current.dependsOn?.length > 0 && <p>{s.dependencies}: {current.dependsOn.map((id: string) => { const at = plan.steps.findIndex((step: E) => step.id === id); return at >= 0 ? `${at + 1}. ${plan.steps[at].title}` : id }).join(' · ')}</p>}{!detail && GROUPS.map(g => (current.parts?.[g]?.length > 0 ? <div key={g}><h3 className="mt-3">{s[g]}</h3>{current.parts[g].map((r: E, i: number) => <div className="assembly-part-row" key={r.key || i}><span>{r.name || r.id || r.key}</span><b>× {r.count}</b></div>)}</div> : null))}</div>}
        <details className="assembly-step-list"><summary data-testid="assembly-step-list">{s.steps} · {index + 1} / {plan.steps.length}</summary>{plan.steps.map((step: E, i: number) => <button data-testid="assembly-step" className="assembly-step" key={step.id || i} aria-current={i === index} onClick={() => selectStep(i)}>{i + 1}. {step.title || `${ordered.find(r => r.id === step.regionId)?.name || step.regionId} · ${step.action?.type === 'attach' ? s.attach : step.action?.type === 'preassemble' ? s.preassemble : s.build}`}</button>)}</details>
      </aside>
    </div>
    <footer className="assembly-preview-footer"><div><p>{plan.canExport ? s.ready : s.blocked}</p><p className="assembly-small">{s.physicalUnverified}</p>{busy && <><progress value={api.exportingManual!.page} max={api.exportingManual!.total} /><span className="assembly-small">{s.exporting} · {api.exportingManual!.page}/{api.exportingManual!.total}</span></>}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index === 0 || busy} onClick={() => selectStep(index - 1)}>{s.previous}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index >= plan.steps.length - 1 || busy} onClick={() => selectStep(index + 1)}>{s.next}</button><button data-testid="assembly-export" className="qb-btn qb-btn-sm" disabled={!plan.canExport || busy || !!viewError} onClick={() => void exportPdf()}>{s.export}</button></div></footer>
  </section>
}
