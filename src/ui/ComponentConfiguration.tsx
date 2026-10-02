import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, LayoutGrid, Minus, Plus, RotateCcw, Search, X } from 'lucide-react'
import type { ComponentChoice } from '../store/componentChoices'
import ComponentChoicePreview from './ComponentChoicePreview'
import { componentMenuLabel, customComponentStrings } from './customComponentStrings'
import './componentConfiguration.css'

const words = {
  zh: { title: '配置快捷圆环', hint: '拖动调整位置 · 点击组件替换', add: '添加', replace: '替换此位置', editing: '正在编辑', search: '搜索名称或尺寸', all: '全部分类', added: '已配置', current: '当前位置', previous: '前移', next: '后移', remove: '移出圆环', restore: '恢复默认', saved: '更改自动保存', saving: '正在保存…', loading: '正在读取组件…', retry: '重新读取', back: '完成', advanced: '保存选区与管理组件', empty: '点击空位添加组件', fixed: '固定取消', cancel: '取消', noResults: '没有匹配的组件', keyboard: '点击编辑；Alt + 左右方向键调整位置。', drop: '松开交换位置', drag: '拖到另一个组件或空位，Esc 取消', close: '结束编辑', slot: '位置', page: '组', choose: '选择组件替换此位置', newPage: '新一组', compact: '移出后，其余组件会依次前移。' },
  en: { title: 'Configure radial menu', hint: 'Drag to reorder · Click to replace', add: 'Add', replace: 'Replace this position', editing: 'Editing', search: 'Search name or size', all: 'All categories', added: 'Configured', current: 'Current', previous: 'Move earlier', next: 'Move later', remove: 'Remove', restore: 'Restore defaults', saved: 'Changes saved automatically', saving: 'Saving…', loading: 'Loading components…', retry: 'Reload', back: 'Done', advanced: 'Save selections and manage components', empty: 'Click an empty position to add', fixed: 'Fixed cancel', cancel: 'Cancel', noResults: 'No matching components', keyboard: 'Click to edit; Alt + Left or Right to reorder.', drop: 'Release to swap positions', drag: 'Drag to a component or empty position. Esc cancels.', close: 'Finish editing', slot: 'Position', page: 'Page', choose: 'Choose a replacement below', newPage: 'New page', compact: 'Remaining components move forward when removed.' },
  de: { title: 'Ringmenü konfigurieren', hint: 'Ziehen zum Sortieren · Zum Ersetzen klicken', add: 'Hinzufügen', replace: 'Position ersetzen', editing: 'Bearbeiten', search: 'Name oder Größe suchen', all: 'Alle Kategorien', added: 'Konfiguriert', current: 'Aktuell', previous: 'Nach vorne', next: 'Nach hinten', remove: 'Entfernen', restore: 'Standardwerte', saved: 'Änderungen automatisch gespeichert', saving: 'Speichern…', loading: 'Komponenten werden geladen…', retry: 'Neu laden', back: 'Fertig', advanced: 'Auswahl speichern und Komponenten verwalten', empty: 'Leere Position zum Hinzufügen anklicken', fixed: 'Abbruch fixiert', cancel: 'Abbrechen', noResults: 'Keine passenden Komponenten', keyboard: 'Klicken zum Bearbeiten; Alt + Pfeil links/rechts zum Sortieren.', drop: 'Loslassen zum Tauschen', drag: 'Auf Komponente oder leere Position ziehen. Esc bricht ab.', close: 'Bearbeitung beenden', slot: 'Position', page: 'Seite', choose: 'Ersatz unten auswählen', newPage: 'Neue Seite', compact: 'Nachfolgende Komponenten rücken beim Entfernen auf.' },
}

type Props = {
  choices: ComponentChoice[]; selectedKeys: string[]; busy: boolean; loading: boolean; error: string; loadFailed: boolean
  onRetry: () => void; onUpdate: (keys: string[]) => Promise<void>; onRestoreDefaults: () => void; onBack: () => void
  selectionEditor: ReactNode; lang: 'zh' | 'en' | 'de'
}
type Drag = { pointerId: number; from: number; key: string; startX: number; startY: number; x: number; y: number; active: boolean; target: number | null }
const capacity = 7
const directWords = {
  zh: { title: '找组件，直接加入', hint: '输入名称或尺寸，直接加入快捷菜单。', eyebrow: '搜索直达', available: '可加入的组件', results: '搜索结果', enter: '回车加入首个结果', replaceEnter: '回车替换此位置', library: '选区组件', libraryBack: '返回快捷配置', ringHint: '拖动调整位置 · 点击组件替换', placeholder: '搜索组件或尺寸，例如 40×40', saved: '更改已保存', resultAdd: '加入', resultReplace: '替换' },
  en: { title: 'Find components, add directly', hint: 'Search by name or size to add to your menu.', eyebrow: 'Direct search', available: 'Available components', results: 'Search results', enter: 'Enter to add the first result', replaceEnter: 'Enter to replace this position', library: 'Saved selections', libraryBack: 'Back to menu settings', ringHint: 'Drag to reorder · Click to replace', placeholder: 'Search component or size, e.g. 40×40', saved: 'Changes saved', resultAdd: 'Add', resultReplace: 'Replace' },
  de: { title: 'Komponenten finden, direkt hinzufügen', hint: 'Nach Name oder Größe suchen und zum Menü hinzufügen.', eyebrow: 'Direktsuche', available: 'Verfügbare Komponenten', results: 'Suchergebnisse', enter: 'Enter fügt den ersten Treffer hinzu', replaceEnter: 'Enter ersetzt diese Position', library: 'Gespeicherte Auswahl', libraryBack: 'Zurück zur Konfiguration', ringHint: 'Ziehen zum Sortieren · Zum Ersetzen klicken', placeholder: 'Komponente oder Größe, z. B. 40×40', saved: 'Änderungen gespeichert', resultAdd: 'Hinzufügen', resultReplace: 'Ersetzen' },
}

export default function ComponentConfiguration({ choices, selectedKeys, busy, loading, error, loadFailed, onRetry, onUpdate, onRestoreDefaults, onBack, selectionEditor, lang }: Props) {
  const s = { ...words[lang], ...directWords[lang] }
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const mutationRef = useRef(false)
  const ignoreClick = useRef<{ index: number; until: number } | null>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const locked = busy || pending || loading || loadFailed
  const pages = Math.max(1, Math.ceil((selectedKeys.length + 1) / capacity))
  const shownPage = Math.min(page, pages - 1)
  const choiceMap = useMemo(() => new Map(choices.map(choice => [choice.key, choice])), [choices])
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const groups = useMemo(() => [...new Set(choices.map(choice => choice.group))], [choices])
  const filtered = useMemo(() => {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[×*＊]/g, 'x').replace(/\s+/g, '')
    const needle = normalize(query.trim())
    return choices.filter(choice => (!group || choice.group === group) && (!needle || normalize(`${choice.label} ${componentMenuLabel(choice, lang)} ${choice.group}`).includes(needle)) && (needle || !selected.has(choice.key)))
  }, [choices, group, query, selected, lang])
  const editIndex = editing === null ? null : Math.min(editing, selectedKeys.length)
  const editChoice = editIndex === null ? undefined : choiceMap.get(selectedKeys[editIndex])
  const firstResult = filtered.find(choice => !selected.has(choice.key))

  const cancelDrag = () => {
    if (dragRef.current?.active) ignoreClick.current = { index: dragRef.current.from, until: performance.now() + 400 }
    dragRef.current = null
    setDrag(null)
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragRef.current) { event.preventDefault(); cancelDrag() } }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useEffect(() => { if (busy || loading) cancelDrag() }, [busy, loading])
  useEffect(() => {
    if (editing !== null) {
      searchRef.current?.focus({ preventScroll: true })
    }
  }, [editing])

  const update = async (next: string[]) => {
    if (locked || mutationRef.current) return
    mutationRef.current = true
    setPending(true)
    try { await onUpdate(next) } finally { mutationRef.current = false; setPending(false) }
  }
  const swap = async (from: number, to: number) => {
    if (locked || from === to || from < 0 || from >= selectedKeys.length || to < 0) return
    const next = [...selectedKeys]
    if (to >= next.length) next.push(...next.splice(from, 1))
    else [next[from], next[to]] = [next[to], next[from]]
    await update(next)
    setEditing(index => index === from ? Math.min(to, next.length - 1) : index === to ? from : index)
  }
  const openSlot = (index: number) => {
    const ignored = ignoreClick.current
    ignoreClick.current = null
    if (locked || (ignored?.index === index && performance.now() < ignored.until)) return
    setEditing(editing === index ? null : Math.min(index, selectedKeys.length)); setQuery(''); setGroup('')
  }
  const choose = async (choice: ComponentChoice) => {
    if (locked || selected.has(choice.key)) return
    const next = [...selectedKeys]
    if (editIndex !== null && editIndex < next.length) next[editIndex] = choice.key
    else next.push(choice.key)
    await update(next)
    if (editIndex === null) setPage(Math.floor((next.length - 1) / capacity))
  }
  const targetAt = (x: number, y: number) => {
    const slots = ringRef.current?.querySelectorAll<HTMLButtonElement>('.cc-mini-slot[data-index]')
    if (!slots) return null
    for (const slot of slots) { const r = slot.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(slot.dataset.index) }
    return null
  }
  const pointerDown = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    ignoreClick.current = null
    if (locked || event.button !== 0 || !selectedKeys[index]) return
    dragRef.current = { pointerId: event.pointerId, from: index, key: selectedKeys[index], startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, target: null }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const active = current.active || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 8
    const next = { ...current, active, x: event.clientX, y: event.clientY, target: active ? targetAt(event.clientX, event.clientY) : null }
    dragRef.current = next
    if (active) { event.preventDefault(); setDrag(next) }
  }
  const pointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    dragRef.current = null; setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!current.active) return
    event.preventDefault(); ignoreClick.current = { index: current.from, until: performance.now() + 400 }
    if (current.target !== null && selectedKeys[current.from] === current.key) void swap(current.from, current.target)
  }
  const changePage = (next: number) => { cancelDrag(); setPage(next); setEditing(null) }

  return <div className="cc-configuration cc-search-direct" data-dragging={!!drag?.active} data-editing={editing !== null}>
    <header className="cc-header"><span className="cc-eyebrow">{s.eyebrow}</span><h2>{s.title}</h2><p>{s.hint}</p></header>
    {(error || loading) && <div className={`cc-message ${error ? 'cc-message-error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || s.loading}</span>{loadFailed && <button type="button" onClick={onRetry} disabled={busy}>{s.retry}</button>}</div>}
    <div className="cc-body" data-library={expanded}>
      {expanded ? <section className="cc-selection-editor"><button type="button" className="cc-library-back" onClick={() => setExpanded(false)}><ArrowLeft size={15} />{s.libraryBack}</button><div className="cc-selection-content">{selectionEditor}</div></section> : <>
      <section className="cc-wheel-editor" aria-label={s.title}>
        <div className="cc-mini-ring" ref={ringRef}>
          <div className="cc-mini-orbit" aria-hidden="true" />
          <div className="cc-mini-center" aria-hidden="true"><LayoutGrid size={20} /><strong>{customComponentStrings[lang].configure}</strong></div>
          {Array.from({ length: 8 }, (_, slot) => {
            const angle = (slot * 45 - 90) * Math.PI / 180
            const style = { left: `${50 + Math.cos(angle) * 35}%`, top: `${50 + Math.sin(angle) * 35}%` }
            if (slot === 3) return <div key="cancel" className="cc-mini-fixed" style={style} title={s.fixed}><span className="cc-mini-disc"><X size={22} /></span><span className="cc-mini-name">{s.cancel}</span></div>
            const index = shownPage * capacity + (slot > 3 ? slot - 1 : slot)
            const choice = choiceMap.get(selectedKeys[index])
            return <button key={slot} type="button" className="cc-mini-slot" style={style} data-index={index} data-key={choice?.key || ''} data-empty={!choice} data-editing={editIndex === index} data-drag-source={drag?.from === index} data-drop={drag?.target === index && drag.from !== index} disabled={locked} title={`${s.slot} ${index + 1}: ${choice?.label || s.add}. ${s.keyboard}`} aria-label={`${s.slot} ${index + 1}: ${choice?.label || s.add}`} aria-pressed={editIndex === index}
              onClick={() => openSlot(index)} onPointerDown={event => pointerDown(event, index)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
              onKeyDown={event => { if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && choice) { event.preventDefault(); const target = index + (event.key === 'ArrowLeft' ? -1 : 1); if (target >= 0 && target < selectedKeys.length) void swap(index, target) } }}>
              <span className="cc-mini-disc">{choice ? <ComponentChoicePreview choice={choice} /> : <Plus size={20} />}</span><span className="cc-mini-name" title={choice?.label || s.add}>{choice ? componentMenuLabel(choice, lang) : s.add}</span>
            </button>
          })}
        </div>
        <div className="cc-ring-controls"><button type="button" aria-label={s.previous} disabled={locked || shownPage === 0} onClick={() => changePage(shownPage - 1)}><ChevronLeft size={18} /></button><span>{shownPage * capacity >= selectedKeys.length && shownPage > 0 ? s.newPage : `${shownPage + 1} / ${pages}`}</span><button type="button" aria-label={s.next} disabled={locked || shownPage >= pages - 1} onClick={() => changePage(shownPage + 1)}><ChevronRight size={18} /></button><button type="button" className="cc-restore" disabled={locked} onClick={onRestoreDefaults}><RotateCcw size={13} />{s.restore}</button></div>
        <p className="cc-ring-hint" role="status">{drag?.active ? drag.target !== null && drag.target !== drag.from ? s.drop : s.drag : s.ringHint}</p>
      </section>
      <section className="cc-slot-editor" aria-label={s.eyebrow}>
        {editIndex !== null && <>
        <div className="cc-edit-heading"><div><span>{s.slot} {editIndex + 1}</span><h3>{editChoice?.label || s.add}</h3></div><button type="button" aria-label={s.close} onClick={() => { setEditing(null); ringRef.current?.scrollIntoView({ block: 'start' }); ringRef.current?.querySelector<HTMLButtonElement>(`[data-index="${editIndex}"]`)?.focus({ preventScroll: true }) }}><X size={18} /></button></div>
        {editChoice && <div className="cc-edit-actions"><button type="button" data-action="move-before" disabled={locked || editIndex === 0} onClick={() => void swap(editIndex, editIndex - 1)}><ArrowLeft size={15} />{s.previous}</button><button type="button" data-action="move-after" disabled={locked || editIndex === selectedKeys.length - 1} onClick={() => void swap(editIndex, editIndex + 1)}><ArrowRight size={15} />{s.next}</button><button type="button" data-action="remove" title={s.compact} disabled={locked} onClick={() => { void update(selectedKeys.filter((_, index) => index !== editIndex)); setEditing(null) }}><Minus size={15} />{s.remove}</button></div>}
        </>}
        <div className="cc-filters"><label className="cc-search"><Search size={16} /><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={s.placeholder} aria-label={s.search} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && firstResult) { event.preventDefault(); void choose(firstResult) } }} /></label><select value={group} onChange={event => setGroup(event.target.value)} aria-label={s.all}><option value="">{s.all}</option>{groups.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="cc-result-heading"><span>{query ? s.results : s.available} · {filtered.length}</span><span>{editChoice ? s.replaceEnter : s.enter}</span></div>
        <div className="cc-catalogue-list">{filtered.map(choice => <button key={choice.key} type="button" className="cc-catalogue-card" data-choice-key={choice.key} data-added={selected.has(choice.key)} data-first={!!query && choice.key === firstResult?.key} disabled={locked || selected.has(choice.key)} onClick={() => void choose(choice)}><span className="cc-catalogue-image"><ComponentChoicePreview choice={choice} /></span><span className="cc-catalogue-name">{choice.label}<small>{choice.group}</small></span><span className="cc-add-state">{selected.has(choice.key) ? <Check size={13} /> : <Plus size={13} />}{selected.has(choice.key) ? s.added : editChoice ? s.resultReplace : s.resultAdd}</span></button>)}{!filtered.length && <p className="cc-empty">{s.noResults}</p>}</div>
      </section>
      </>}
    </div>
    <footer className="cc-footer"><div className="cc-footer-meta"><button type="button" className="cc-library-button" aria-label={s.advanced} aria-expanded={expanded} onClick={() => { setEditing(null); setExpanded(!expanded) }}>{s.library} ↗</button><span className="cc-save-state" role="status"><i />{busy || pending ? s.saving : s.saved}</span></div><button type="button" className="qb-btn primary cc-back" disabled={locked} onClick={onBack}>{s.back}</button></footer>
    {drag?.active && choiceMap.has(drag.key) && createPortal(<div className="cc-drag-ghost" style={{ left: drag.x + 12, top: drag.y - 24 }} aria-hidden="true"><ComponentChoicePreview choice={choiceMap.get(drag.key)!} /></div>, document.body)}
  </div>
}
