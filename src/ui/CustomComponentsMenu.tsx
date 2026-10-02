import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, LayoutGrid, Plus, X } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { listComponents, readComponentConfiguration, removeComponent, saveComponent, saveComponentConfiguration, type ComponentFragment, type CustomComponent } from '../store/customComponents'
import { activateComponent, componentChoices, DEFAULT_COMPONENT_KEYS, type ComponentChoice } from '../store/componentChoices'
import { componentMenuLabel, customComponentStrings } from './customComponentStrings'
import CustomComponentPreview from './CustomComponentPreview'
import { UI_ESCAPE_EVENT } from './events'
import ComponentChoicePreview from './ComponentChoicePreview'
import ComponentConfiguration from './ComponentConfiguration'

export const CUSTOM_COMPONENTS_EVENT = 'quadro:custom-components'
export type ComponentMenuPosition = { x: number; y: number; held?: boolean }

export default function CustomComponentsMenu({ position, onClose }: { position: ComponentMenuPosition; onClose: () => void }) {
  const api = useEngine()
  const { lang, t } = useI18n()
  const s = customComponentStrings[lang]
  const [rows, setRows] = useState<CustomComponent[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  const [configuring, setConfiguring] = useState(false)
  const [holding, setHolding] = useState(!!position.held)
  const [activeSlot, setActiveSlot] = useState(-1)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const rootRef = useRef<HTMLDivElement>(null)
  const originFocus = useRef(document.activeElement as HTMLElement | null)
  const report = (err: unknown) => setError(`${s.error}: ${err instanceof Error ? err.message : String(err)}`)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadFailed(false)
    setError('')
    Promise.all([listComponents(), readComponentConfiguration()]).then(async ([list, configuration]) => {
      const available = new Set(componentChoices(api, list, t).map(choice => choice.key))
      const wanted = configuration ?? [...DEFAULT_COMPONENT_KEYS, ...list.map(row => `saved:${row.id}`)]
      const keys = wanted.filter(key => available.has(key))
      if (!configuration || keys.length !== wanted.length) await saveComponentConfiguration(keys)
      if (active) { setRows(list); setSelectedKeys(keys) }
    })
      .catch(err => { if (active) { setLoadFailed(true); report(err) } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  useEffect(() => {
    const resize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    const esc = () => onClose()
    window.addEventListener('resize', resize)
    window.addEventListener(UI_ESCAPE_EVENT, esc)
    const focus = originFocus.current
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener(UI_ESCAPE_EVENT, esc)
      if (focus?.isConnected) focus.focus({ preventScroll: true })
    }
  }, [onClose])

  useLayoutEffect(() => {
    rootRef.current?.querySelector<HTMLElement>(configuring ? '.cc-mini-slot:not(:disabled)' : '[data-configure]')?.focus({ preventScroll: true })
  }, [configuring])

  useLayoutEffect(() => {
    if (!configuring) rootRef.current?.querySelector<HTMLElement>('[data-configure]')?.focus({ preventScroll: true })
  }, [page, viewport.w, viewport.h])

  const slots = 8
  const cancelSlot = 3
  const capacity = slots - 1
  const choices = useMemo(() => componentChoices(api, rows, t), [api.catalog, rows, t])
  const choiceMap = new Map(choices.map(choice => [choice.key, choice]))
  const configured = selectedKeys.map(key => choiceMap.get(key)).filter((choice): choice is ComponentChoice => !!choice)
  const pages = Math.max(1, Math.ceil(configured.length / capacity))
  const current = Math.min(page, pages - 1)
  const visible = configured.slice(current * capacity, (current + 1) * capacity)
  const size = Math.min(viewport.w <= 700 ? 320 : 384, viewport.w - 24, viewport.h - 112)
  const radius = size * 0.36
  const width = configuring ? Math.min(680, viewport.w - 24) : size
  const height = configuring ? Math.min(760, viewport.h - 24) : size + 68
  const left = configuring ? (viewport.w - width) / 2 : Math.max(12, Math.min(position.x - width / 2, viewport.w - width - 12))
  const top = configuring ? (viewport.h - height) / 2 : Math.max(12, Math.min(position.y - size / 2, viewport.h - height - 12))

  const place = (choice: ComponentChoice) => {
    try {
      if (!activateComponent(choice, api)) return
      if (choice.fragment) api.notify(s.placing)
      onClose()
    } catch (err) { report(err) }
  }

  const rowAtSlot = (slot: number) => slot === cancelSlot ? undefined : visible[slot > cancelSlot ? slot - 1 : slot]
  const releaseRef = useRef<() => void>(() => {})
  releaseRef.current = () => {
    setHolding(false)
    if (activeSlot === -1) setConfiguring(true)
    else if (activeSlot === cancelSlot) onClose()
    else {
      const choice = rowAtSlot(activeSlot)
      if (choice && !loading) place(choice)
      else onClose()
    }
  }

  useEffect(() => {
    if (configuring) return
    const move = (e: PointerEvent) => {
      const dx = e.clientX - (left + size / 2), dy = e.clientY - (top + size / 2)
      // 中央圆区是配置；外围按方向无限延伸，不要求鼠标停在按钮上。
      if (Math.hypot(dx, dy) <= (viewport.w <= 430 ? 42 : 48)) setActiveSlot(-1)
      else setActiveSlot(((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2 / slots)) % slots) + slots) % slots)
    }
    const wheel = (e: WheelEvent) => {
      if (!holding || pages <= 1) return
      e.preventDefault()
      if (Math.abs(e.deltaY) > 4) setPage(n => Math.max(0, Math.min(pages - 1, n + (e.deltaY > 0 ? 1 : -1))))
    }
    const release = (e: KeyboardEvent) => {
      if (!holding || (e.code !== 'Digit4' && e.code !== 'Numpad4' && e.key !== '4')) return
      e.preventDefault()
      releaseRef.current()
    }
    const blur = () => { if (holding) onClose() }
    window.addEventListener('pointermove', move)
    window.addEventListener('keyup', release, true)
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('keyup', release, true)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('blur', blur)
    }
  }, [holding, configuring, left, top, size, pages, viewport.w, onClose])

  const updateConfiguration = async (keys: string[]) => {
    if (busy || loading || loadFailed || api.readOnly) return
    setBusy(true)
    setError('')
    try {
      await saveComponentConfiguration(keys)
      setSelectedKeys([...new Set(keys)])
    } catch (err) { report(err) } finally { setBusy(false) }
  }

  const submit = async () => {
    if (busy || !name.trim() || loading || loadFailed || api.readOnly) return
    const old = editing ? rows.find(row => row.id === editing) : null
    const fragment = old?.fragment || (!api.pasting && api.engine()?.builder.copySelection()) as ComponentFragment | null
    if (!fragment) { setError(s.selectFirst); return }
    const tubes = new Set(fragment.tubes.map(tube => tube.id))
    const nodes = new Set(fragment.nodes.map(node => node.id))
    const fittings = new Set(fragment.fittings.map(fitting => fitting.id))
    if (fragment.fittings.some(part => typeof part.tube === 'string' && !tubes.has(part.tube)) ||
      fragment.nodes.some(node => (typeof node.bearingOn === 'string' && !fittings.has(node.bearingOn)) ||
        (node.clampOn && !tubes.has(String((node.clampOn as { tubeId: string }).tubeId)))) ||
      fragment.fittings.some(part => typeof part.node === 'string' && !nodes.has(part.node))) {
      setError(s.incomplete)
      return
    }
    setError('')
    setBusy(true)
    try {
      const row: CustomComponent = { id: old?.id || crypto.randomUUID(), name: name.trim(), fragment: structuredClone(fragment), updatedAt: old?.updatedAt || Date.now() }
      await saveComponent(row)
      setRows(list => old ? list.map(item => item.id === old.id ? row : item) : [...list, row])
      setName('')
      setEditing(null)
      api.notify(old ? s.renamed : s.saved)
    } catch (err) { report(err) } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    if (busy || api.readOnly) return
    setBusy(true)
    try {
      await removeComponent(id)
      setRows(list => list.filter(row => row.id !== id))
      setSelectedKeys(keys => keys.filter(key => key !== `saved:${id}`))
      setDeleting(null)
      if (editing === id) { setEditing(null); setName('') }
      api.notify(s.deleted)
    } catch (err) { report(err) } finally { setBusy(false) }
  }

  const selectionEditor = <>
    <form onSubmit={e => { e.preventDefault(); void submit() }}>
      <h3>{editing ? s.rename : s.saveSelection}</h3>
      <p>{editing ? rows.find(row => row.id === editing)?.name : api.selectionCount && !api.pasting ? s.selected : s.noSelection}</p>
      <label htmlFor="component-name">{s.name}</label>
      <input id="component-name" value={name} maxLength={80} placeholder={s.placeholder} disabled={busy || loading}
        onChange={e => { setName(e.target.value); if (!loading) setError('') }} />
      <div className="qb-components-actions">
        {editing && <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => { setEditing(null); setName(''); setError('') }}>{s.back}</button>}
        <button type="submit" className="qb-btn qb-btn-sm" disabled={busy || loading || loadFailed || !name.trim() || (!editing && (!api.selectionCount || api.pasting))}>{editing ? s.rename : s.save}</button>
      </div>
    </form>
    <h3>{s.savedList} · {rows.length}</h3>
    {!loading && !rows.length && !loadFailed && <p>{s.noneSaved}</p>}
    <div className="qb-components-list">
      {rows.map(row => <div key={row.id} className="qb-components-row">
        <CustomComponentPreview fragment={row.fragment} />
        <span title={row.name}>{row.name}</span>
        <button type="button" disabled={busy} onClick={() => { setEditing(row.id); setName(row.name); setDeleting(null); setError(''); rootRef.current?.querySelector<HTMLInputElement>('#component-name')?.focus() }}>{s.rename}</button>
        <button type="button" disabled={busy} onClick={() => setDeleting(deleting === row.id ? null : row.id)}>{s.delete}</button>
        {deleting === row.id && <div className="qb-components-delete"><p>{s.deleteConfirm}</p><div className="qb-components-actions">
          <button type="button" disabled={busy} className="qb-btn qb-btn-ghost qb-btn-sm" onClick={() => setDeleting(null)}>{s.deleteCancel}</button>
          <button type="button" disabled={busy} className="qb-btn qb-btn-sm" onClick={() => void remove(row.id)}>{s.confirmDelete}</button>
        </div></div>}
      </div>)}
    </div>
  </>

  return createPortal(
    <div className="qb-components-layer fixed inset-0 z-[65]" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label={s.title} lang={lang} data-ui="custom-components" data-configuring={configuring} data-holding={holding}
        className={configuring ? 'qb-card qb-components-config' : 'qb-components-wheel qb-components-wheel-light'}
        style={{ left, top, width, height, maxHeight: viewport.h - 24, '--cc-wheel-size': `${size}px` } as CSSProperties}
        onKeyDown={e => {
          if (e.key !== 'Tab') return
          const buttons = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') || [])].filter(el => el.getClientRects().length > 0)
          const first = buttons[0], last = buttons.at(-1)
          if (!buttons.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus() }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        }}>
        {configuring && <button type="button" className="qb-component-close" aria-label={s.close} onClick={onClose}><X size={17} /></button>}
        {configuring ? <ComponentConfiguration choices={choices} selectedKeys={selectedKeys} busy={busy} loading={loading} error={error} loadFailed={loadFailed}
          onRetry={() => setReload(n => n + 1)} onUpdate={updateConfiguration} onRestoreDefaults={() => void updateConfiguration(DEFAULT_COMPONENT_KEYS)}
          onBack={() => { setConfiguring(false); setError('') }} selectionEditor={selectionEditor} lang={lang} /> : <>
          <div className="qb-component-orbit" aria-hidden="true" style={{ width: radius * 2, height: radius * 2, left: size / 2 - radius, top: size / 2 - radius }} />
          <button type="button" data-configure data-active={activeSlot === -1} className="qb-component-center" style={{ left: size / 2, top: size / 2 }} onClick={() => { if (!holding) setConfiguring(true) }}>
            <LayoutGrid size={22} /><span>{s.configure}</span><small aria-label={`${configured.length} ${s.count}`}>{configured.length}</small>
          </button>
          {Array.from({ length: slots }, (_, i) => {
            const row = rowAtSlot(i)
            const cancel = i === cancelSlot
            const angle = -Math.PI / 2 + i * Math.PI * 2 / slots
            return <button type="button" key={cancel ? 'cancel' : row?.key || `empty-${i}`} data-cancel={cancel || undefined} data-slot={i} data-active={activeSlot === i}
              className="qb-component-slot" disabled={!cancel && (!row || loading)} title={cancel ? holding ? s.cancelOnRelease : s.cancel : row?.label || s.empty}
              aria-label={cancel ? holding ? s.cancelOnRelease : s.cancel : row?.label || s.empty} style={{ left: size / 2 + Math.cos(angle) * radius, top: size / 2 + Math.sin(angle) * radius, '--slot-index': i } as CSSProperties}
              onClick={() => { if (holding) return; if (cancel) onClose(); else if (row) place(row) }}>
              <span className="qb-component-disc">{cancel ? <X size={24} /> : row ? <ComponentChoicePreview choice={row} /> : <Plus size={16} />}</span>
              {(cancel || row) && <span className="qb-component-slot-label" title={cancel ? holding ? s.cancelOnRelease : s.cancel : row?.label || ''}>{cancel ? holding ? s.cancelOnRelease : s.cancel : row ? componentMenuLabel(row, lang) : ''}</span>}
            </button>
          })}
          <div className="qb-components-pager qb-component-summary" data-cancel={activeSlot === cancelSlot} style={{ top: size + 12 }} role="status">
            {error ? <p role="alert">{error}</p> : loading ? <p>{s.loading}</p> : !configured.length ? <p>{s.empty}</p> : <>
              {pages > 1 && <button type="button" aria-label={s.previous} disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={18} /></button>}
              <div><strong>{activeSlot === cancelSlot ? holding ? s.cancelRelease : s.cancelClick : activeSlot === -1 ? holding ? s.centreRelease : s.centreClick : rowAtSlot(activeSlot) ? holding ? `${s.useRelease} ${componentMenuLabel(rowAtSlot(activeSlot)!, lang)}` : componentMenuLabel(rowAtSlot(activeSlot)!, lang) : s.unconfigured}</strong><span>{holding ? pages > 1 ? `${s.scrollHint} · ${current + 1} / ${pages}` : s.outside : `${s.clickHint}${pages > 1 ? ` · ${current + 1} / ${pages}` : ''}`}</span></div>
              {pages > 1 && <button type="button" aria-label={s.next} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChevronRight size={18} /></button>}
            </>}
          </div>
        </>}
      </div>
    </div>, document.body,
  )
}
