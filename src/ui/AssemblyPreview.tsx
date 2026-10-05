import { useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { BuildModel, SceneManager, colorName, partName, getPartById } from '../engine-api'
import { computeAssemblyPlan } from '../engine/assemblyPlan.js'
import { takeModelThumb, waitSceneReady } from '../engine/thumbShot.js'
import { coverItems, renderedBounds, manualPositionedItems, layoutManualCallouts, projectedOperationArrowHead, projectReadingLocatorBounds } from '../engine/assemblyManual.js'
import { createAssemblyReadingPlan, assemblyReadingState, readingModuleDirection } from '../engine/assemblyReadingPlan.js'
import { useEngine, type AssemblyConfig } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { assemblyStrings, assemblyDiagnosticText, assemblyPdfStrings } from './assemblyStrings'
import { UI_ESCAPE_EVENT } from './events'
import { layoutAssemblyMarks } from './assemblyOverlay'
import { loadAssemblyPartImage } from './assemblyPartImages'
import './AssemblyPreview.css'

// 引擎计划由 Vanilla JS 提供。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any
const GROUPS = ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'reinforcements'] as const

function AssemblyPhoto({ item, onError }: { item: E; onError: (message: string) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setSrc(null)
    void loadAssemblyPartImage(item).then(image => { if (active) setSrc(image) }).catch(error => { if (active) onError(String(error)) })
    return () => { active = false }
  }, [item.id, item.kind, item.color, onError])
  return src ? <img src={src} alt={item.name} data-testid="assembly-part-photo" data-part-id={item.id} data-part-color={item.color || ''} /> : <span className="assembly-photo-loading" aria-hidden="true" />
}

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
  const [overlay, setOverlay] = useState<{ width: number; height: number; marks: E[]; arrows: E[]; connectorRects: E[] }>({ width: 1, height: 1, marks: [], arrows: [], connectorRects: [] })
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
  const reading = useMemo(() => {
    if (!preview) return null
    const model = new BuildModel()
    if (!model.loadJSON(preview.data).ok) throw new Error('Assembly reading snapshot failed')
    const items = coverItems(preview.plan.bom)
    return { ...createAssemblyReadingPlan(model, preview.plan, { items, copy: assemblyPdfStrings[lang] }), items }
  }, [preview?.plan, preview?.data, lang])
  useEffect(() => { if (reading) setIndex(value => Math.min(value, reading.steps.length + 1)) }, [reading?.steps.length])

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
    setIndex(0)
    setDetailId(null)
    setExpanded(false)
    locationCache.current = null
  }, [preview?.data])

  useEffect(() => {
    if (!preview || !reading || !view.current) return
    const v = view.current
    const draw = () => {
      try {
      const entry = reading.steps[index - 1]
      const detail: E = !whole && !marked.length ? entry?.areas.find((area: E) => area.id === detailId) : null
      let assembly: E = null
      if (entry && !whole && !marked.length) {
        assembly = assemblyReadingState(v.model, preview.plan, entry, { area: detail, structure: entry.kind !== 'module' && action, whole: !detail && !action })
      }
      const rows = detail?.materials || entry?.materials || []
      const priority = [...rows].sort((a: E, b: E) => (a.kind === 'connectors' ? 0 : 1) - (b.kind === 'connectors' ? 0 : 1) || a.num - b.num)
      const materials = entry && assembly ? priority.slice(action ? 0 : 6, action ? 6 : 12) : []
      const viewKey = `${index}:${detail?.id || 'overview'}:${action}:${whole}:${marked.join(',')}`
      const preferred = entry?.kind === 'module' ? readingModuleDirection(v.model, preview.plan, entry) : detail && !action ? [-1, .75, -1] : [1, .75, 1]
      const direction = cameraViewKey.current !== viewKey ? new Vector3(...preferred).normalize() : v.scene.camera.position.clone().sub(v.scene.controls.target).normalize() as Vector3
      cameraViewKey.current = viewKey
      if (detail || entry?.kind === 'module') {
        const key = `${index}:${detail?.id || 'module'}:${action}`
        if (locationCache.current?.plan !== preview.plan || locationCache.current?.key !== key) {
          const overview = assemblyReadingState(v.model, preview.plan, entry, { whole: true })
          overview.visible = new Set(GROUPS.flatMap(group => [...(v.model[group]?.keys() || [])]).concat([...v.model.nodes.keys()], [...v.model.clamps.keys()]))
          overview.current = new Set(detail?.partIds || entry.partIds)
          overview.done = new Set([...overview.visible].filter((id: string) => !overview.current.has(id)))
          overview.transforms = new Map()
          v.scene.renderModel(v.model, null, { assembly: overview })
          const bounds = renderedBounds(v.scene, v.model)
          v.scene._viewSize = { w: 300, h: 220 }
          let image: string
          try {
            let complete = false
            for (const margin of [1.2, 1.45, 1.8]) {
              v.scene._frameAlong(v.model, new Vector3(...preferred).normalize(), { silent: true, bounds, aspect: 300 / 220, margin })
              complete = projectReadingLocatorBounds(v.scene, bounds, 300 / 220).complete
              if (complete) break
            }
            if (!complete) throw new Error('Assembly locator could not fit the complete structure')
            image = v.scene.snapshot({ width: 300, height: 220, pixelRatio: 1, hideRoom: true, hideLabels: true })
          } finally { v.scene._viewSize = null }
          locationCache.current = { plan: preview.plan, key, image }
          setLocationImage(image)
        }
      } else setLocationImage(null)
      projectOverlay.current = () => {
        const width = host.current?.clientWidth || 1, height = host.current?.clientHeight || 1
        const marks = [], arrows = []
        const interfaces = entry?.kind === 'module' && assembly ? (preview.plan.interfaces || []).filter((marker: E) => entry.interfaceIds.includes(marker.id) && marker.position) : []
        interfaces.forEach((marker: E, i: number) => { const point = v.scene.projectWorld([marker.position])[0]; if (point) marks.push({ x: point.u * width, y: point.v * height, label: String.fromCharCode(65 + i) }) })
        for (const item of manualPositionedItems(v.model, materials, assembly)) {
          const projected = v.scene.projectWorld(item.positions).filter((p: E) => p && p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)
          const point = projected[0]
          if (point) marks.push({ x: point.u * width, y: point.v * height, label: String(item.num), kind: 'material' })
        }
        for (const area of !detail && entry?.kind === 'layer' ? entry.areas : []) {
          const point = v.scene.projectWorld([area.center])[0]
          if (point) marks.push({ x: point.u * width, y: point.v * height, label: area.label })
        }
        for (const arrow of assembly?.arrows || []) {
          const [from, to] = v.scene.projectWorld([arrow.from, arrow.to])
          if (from && to) arrows.push({ x1: from.u * width, y1: from.v * height, x2: to.u * width, y2: to.v * height })
        }
        const materialMarks = marks.filter(mark => mark.kind === 'material')
        const placedMaterials = layoutManualCallouts(materialMarks, width, height, 12)
        const interfaceMarks = layoutAssemblyMarks(marks.filter(mark => !mark.kind), width, height, { radius: 12 })
        setOverlay({ width, height, marks: [...placedMaterials, ...interfaceMarks], arrows, connectorRects: [] })
      }
      const tints = marked.length ? new Map(marked.map(id => [id, '#dc603e'])) : null
      v.scene.renderModel(v.model, null, { assembly, tints, dimUntinted: !!marked.length })
      v.scene.onResize()
      const bounds = renderedBounds(v.scene, v.model)
      if (bounds && assembly?.arrows.length) {
        for (const arrow of assembly.arrows) for (const point of [arrow.from, arrow.to]) for (let axis = 0; axis < 3; axis++) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis] - 5)
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis] + 5)
          bounds.size[axis] = bounds.max[axis] - bounds.min[axis]
        }
      }
      v.scene._frameAlong(v.model, direction, { animate: false, bounds, margin: 1.18 })
      projectOverlay.current()
      if (import.meta.env.DEV && host.current) host.current.dataset.frame = JSON.stringify({ bounds, camera: v.scene.cameraState(), size: v.scene._viewSize })
      v.scene.requestRender()
      } catch (error) { setViewError(String(error)) }
    }
    v.scene.onMeshesReady = () => { locationCache.current = null; draw() }
    redraw.current = draw
    draw()
  }, [preview?.plan, preview?.data, reading, index, whole, action, marked, detailId, expanded])

  if (!open || !preview || !reading) return null
  const plan = preview.plan
  const copy = assemblyPdfStrings[lang]
  const config = preview.config
  const ordered = config.order.map(id => config.regions.find(r => r.id === id)!).filter(Boolean)
  const entry = reading.steps[index - 1]
  const details: E[] = entry?.areas || []
  const detail: E = !whole && !marked.length ? details.find(group => group.id === detailId) : null
  const detailIndex = detail ? details.findIndex(group => group.id === detail.id) : -1
  const materials: E[] = detail?.materials || entry?.materials || (index === 0 ? reading.items : [])
  const heading = entry ? copy.readingStepHeading.replace('{k}', String(index)).replace('{n}', String(reading.steps.length)).replace('{title}', entry.title) : index === 0 ? s.all : copy.finalTitle
  const viewCaption = detail ? action ? copy.readingStructureFront : copy.readingCompleteBack : entry ? action ? entry.kind === 'module' ? copy.readingModule : copy.readingLayerStructure : copy.readingWholeLocation : s.overview
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
        <div className="assembly-view-toolbar"><div className="assembly-view-heading"><span className="assembly-small" data-testid="assembly-step-number">{heading}</span>{detail && <strong>{copy.readingArea.replace('{area}', detail.label)}</strong>}</div><div className="assembly-preview-tools">{entry && <><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-action-view" aria-pressed={action} disabled={busy} onClick={() => { setAction(true); setWhole(false); setMarked([]) }}>{detail ? copy.readingStructureFront : entry.kind === 'module' ? copy.readingModule : copy.readingLayerStructure}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-complete-view" aria-pressed={!action} disabled={busy} onClick={() => { setAction(false); setWhole(false); setMarked([]) }}>{detail ? copy.readingCompleteBack : copy.readingWholeLocation}</button></>}<button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-enlarge" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? s.shrink : s.enlarge}</button></div></div>
        <div className="assembly-drawing">
        <div ref={host} className="assembly-preview-host" data-testid="assembly-preview-canvas" />
        <svg className="assembly-interface-overlay" viewBox={`0 0 ${overlay.width} ${overlay.height}`} aria-hidden="true" data-testid="assembly-interface-overlay" data-connector-callout-rects={JSON.stringify(overlay.connectorRects)}>
          {overlay.marks.map((m, i) => <g key={`leader-${i}`} transform={`translate(${m.x},${m.y})`}>
            <line x1="0" y1="0" x2={m.anchorX - m.x} y2={m.anchorY - m.y} stroke="#ea580c" strokeWidth="1" />
            <circle cx={m.anchorX - m.x} cy={m.anchorY - m.y} r="2" fill="#ea580c" />
          </g>)}
          {overlay.arrows.map((a, i) => {
            const head = projectedOperationArrowHead(a, 8)
            return head && <g key={`a-${i}`} data-testid="assembly-detail-arrow">
              <line {...a} stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
              <line {...a} stroke="#c2410c" strokeWidth="2.5" strokeLinecap="round" />
              <polygon points={[head.tip, head.left, head.right].map(point => point.join(',')).join(' ')} fill="#c2410c" stroke="#fff" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke" />
            </g>
          })}
          {overlay.marks.map((m, i) => <g key={`m-${i}`} transform={`translate(${m.x},${m.y})`} data-mark-kind={m.kind || 'interface'} data-testid={m.kind === 'material' ? 'assembly-detail-material' : undefined}>
            <circle r="12" fill="#fffaf3" stroke="#ea580c" strokeWidth="2" />
            <text textAnchor="middle" dominantBaseline="central" fill="#9a4113" fontSize="11" fontWeight="700">{m.label}</text>
          </g>)}
        </svg>
        {viewError && <p role="alert">{viewError}</p>}
        </div>
        <div className="assembly-view-caption"><div><strong data-testid="assembly-view-direction">{viewCaption}</strong><p>{s.rotate}</p></div>{(detail || entry?.kind === 'module') && locationImage && <figure className="assembly-location" data-testid="assembly-detail-location"><img src={locationImage} alt={copy.readingLocation} /><figcaption>{copy.readingLocation}{detail ? ` · ${detail.label}` : ''}</figcaption></figure>}</div>
        {details.length > 0 && <nav className="assembly-detail-navigation" aria-label={s.details}><button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-overview" aria-current={!detail ? 'true' : undefined} onClick={() => selectDetail(null)}>{s.overview}</button>{details.map((group: E) => <button className="qb-btn qb-btn-ghost qb-btn-sm" data-testid="assembly-detail" key={group.id} aria-current={detail?.id === group.id ? 'true' : undefined} onClick={() => selectDetail(group.id)}>{copy.readingArea.replace('{area}', group.label)}</button>)}</nav>}
        <div className="assembly-detail-paging">{detail && <><span>{detailIndex + 1} / {details.length}</span><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={detailIndex === 0} onClick={() => selectDetail(details[detailIndex - 1].id)}>{s.detailPrevious}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={detailIndex === details.length - 1} onClick={() => selectDetail(details[detailIndex + 1].id)}>{s.detailNext}</button></>}<button className="qb-btn qb-btn-ghost qb-btn-sm assembly-read-instructions" data-testid="assembly-read-instructions" onClick={readInstructions}>{s.materials}</button></div>
      </div>
      <aside className="assembly-preview-sidebar assembly-reading-sidebar">
        {stale && <p role="status">{s.stale}</p>}
        {api.readOnly && <p>{s.readonly}</p>}
        {preview.repair?.validation?.loadVerified === false && <p>{s.repairPhysical}</p>}
        {preview.repair && <div className="assembly-repair" data-testid="assembly-repair-preview"><h3>{s.repairTitle}</h3><p>{s.repairHint}</p>{preview.repair.changes.map((c: E, i: number) => <div className="assembly-repair-change" key={i}><strong>{c.action === 'remove' || c.type === 'remove' ? s.remove : s.change} · {c.catalogPartId ? partName(getPartById(c.catalogPartId)) || c.catalogPartId : names.get(c.tubeId) || c.tubeId || c.partId || c.nodeId}</strong><p>{c.before?.color && colorName(c.before.color)} · {c.tubeId || c.partId} · {c.before?.a} ↔ {c.before?.b}</p>{c.action === 'remove' && <p>{s.duplicatePort}</p>}<details><summary>{s.before} / {s.after}</summary><div className="assembly-small">{s.before}: {JSON.stringify(c.before)}<br />{s.after}: {JSON.stringify(c.after)}</div></details></div>)}{preview.repair.bomChanges?.map((row: E, i: number) => <div className="assembly-part-row" key={i}><span>{row.name || preview.repair.beforeBOM?.[row.group]?.find((r: E) => (r.key || r.type || r.id) === row.key)?.name || row.key || row.id}</span><b>{row.before} → {row.after}</b></div>)}{preview.repair.diagnostics?.map((d: E, i: number) => <p key={i}>{diagnosticText(d)}</p>)}<div className="assembly-preview-tools"><button data-testid="assembly-repair-apply" className="qb-btn qb-btn-sm" disabled={busy || api.readOnly || stale || !preview.repair.canApply} onClick={() => { if (!api.applyManualRepairs()) api.notify(s.failedApply, 'warn') }}>{s.apply}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={busy} onClick={api.discardManualRepairs}>{s.discard}</button></div></div>}
        {plan.diagnostics.length > 0 && <><h3>{s.diagnostics}</h3>{!preview.repair && plan.diagnostics.some((d: E) => d.repairable) && <button className="qb-btn qb-btn-ghost qb-btn-sm mb-3" disabled={busy} onClick={() => api.reviewManualRepairs([...new Set<string>(plan.diagnostics.filter((d: E) => d.repairable).flatMap((d: E) => d.nodeIds || []))])}>{s.repair}</button>}{plan.diagnostics.map((d: E, i: number) => <div className="assembly-diagnostic" key={i} data-severity={d.severity}><strong>{diagnosticText(d)}</strong><div className="assembly-small">{[...(d.nodeIds || []), ...(d.partIds || [])].join(' · ')}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => { setMarked([...new Set<string>([...(d.nodeIds || []), ...(d.partIds || [])])]); setWhole(true) }}>{s.locate}</button></div></div>)}</>}
        {entry && <div className="assembly-preview-tools mb-3"><button className="qb-btn qb-btn-ghost qb-btn-sm" aria-pressed={whole} onClick={() => { setWhole(value => !value); setMarked([]) }}>{s.all}</button></div>}
        {materials.length > 0 && <div className="assembly-current-instructions" data-testid="assembly-instructions" data-source-step-ids={JSON.stringify(entry?.sourceStepIds || [])}><h3>{detail ? copy.readingAreaParts.replace('{area}', detail.label) : entry ? s.materials : copy.bomTitle}</h3><ul className="assembly-detail-materials">{materials.map((item: E) => <li key={item.key} data-material-key={`${item.kind}:${item.ledgerKey}`} data-material-count={item.count}><span className="assembly-material-number">{item.num}</span><AssemblyPhoto item={item} onError={setViewError} /><span>{item.name}{item.colorName && <small>{item.colorName}</small>}</span><b>×{item.count}</b></li>)}</ul>{detail && <p className="assembly-small">{copy.readingQuantityNote}</p>}</div>}
        <details className="assembly-step-list"><summary data-testid="assembly-step-list">{s.steps} · {reading.steps.length}</summary><button data-testid="assembly-reading-cover" className="assembly-step" aria-current={index === 0} onClick={() => selectStep(0)}>{s.overview}</button>{reading.steps.map((step: E, i: number) => <button data-testid="assembly-step" className="assembly-step" key={step.id} aria-current={i + 1 === index} onClick={() => selectStep(i + 1)}>{i + 1}. {step.title}</button>)}<button data-testid="assembly-reading-final" className="assembly-step" aria-current={index === reading.steps.length + 1} onClick={() => selectStep(reading.steps.length + 1)}>{copy.finalTitle}</button></details>
      </aside>
    </div>
    <footer className="assembly-preview-footer"><div><p>{plan.canExport ? s.ready : s.blocked}</p><p className="assembly-small">{s.physicalUnverified}</p>{busy && <><progress value={api.exportingManual!.page} max={api.exportingManual!.total} /><span className="assembly-small">{s.exporting} · {api.exportingManual!.page}/{api.exportingManual!.total}</span></>}</div><div className="assembly-preview-tools"><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index === 0 || busy} onClick={() => selectStep(index - 1)}>{s.previous}</button><button className="qb-btn qb-btn-ghost qb-btn-sm" disabled={index >= reading.steps.length + 1 || busy} onClick={() => selectStep(index + 1)}>{s.next}</button><button data-testid="assembly-export" className="qb-btn qb-btn-sm" disabled={!plan.canExport || busy || !!viewError} onClick={() => void exportPdf()}>{s.export}</button></div></footer>
  </section>
}
