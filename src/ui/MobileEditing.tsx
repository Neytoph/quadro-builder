import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown, ClipboardPaste, Copy, Ellipsis, FlipHorizontal2, FlipVertical2,
  Group, Minus, Plus, RotateCcw, RotateCw, Scan, SquareDashed, Trash2, Ungroup,
} from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { Pop } from './Pop'
import { mobileEditingStrings } from './mobileEditingStrings'
import './mobileEditing.css'

type Action = {
  label: string
  icon: ReactNode
  run: () => void
  disabled?: boolean
  divider?: boolean
  count?: number
}

function EditingMenu({ anchor, label, actions, onClose, align = 'right' }: {
  anchor: HTMLButtonElement
  label: string
  actions: Action[]
  onClose: () => void
  align?: 'left' | 'right' | 'center'
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [])
  const finish = () => {
    onClose()
    anchor.focus({ preventScroll: true })
  }
  return <Pop anchor={anchor} align={align} width={220} leaving={false} onClose={onClose} className="qb-edit-pop">
    <div ref={list} data-ui="editing-menu" role="group" aria-label={label} onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish()
    }}>
      {actions.map(action => <div key={action.label}>
        {action.divider && <hr />}
        <button type="button" disabled={action.disabled} data-danger={action.count !== undefined}
          onClick={() => { finish(); action.run() }}>
          {action.icon}<span>{action.label}</span>{action.count !== undefined && <span className="qb-edit-count">{action.count}</span>}
        </button>
      </div>)}
    </div>
  </Pop>
}

export function MobileSelectionMenu({ anchor, onClose }: { anchor: HTMLButtonElement; onClose: () => void }) {
  const api = useEngine()
  const { lang } = useI18n()
  const s = mobileEditingStrings[lang]
  return <EditingMenu anchor={anchor} label={s.selection} onClose={onClose} align="left" actions={[
    { label: s.all, icon: <Scan />, run: api.selectAll },
    { label: s.clear, icon: <SquareDashed />, run: api.clearSelection, disabled: !api.selectionCount },
    { label: s.paste, icon: <ClipboardPaste />, run: api.paste, disabled: !api.canPaste, divider: true },
  ]} />
}

function EditMenuButton({ label, icon, actions, disabled, iconOnly, secondary, align }: {
  label: string
  icon: ReactNode
  actions: Action[]
  disabled?: boolean
  iconOnly?: boolean
  secondary?: boolean
  align?: 'right' | 'center'
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return <>
    <button ref={anchor} type="button" aria-label={label} aria-expanded={open && !disabled}
      className={`qb-btn qb-btn-sm ${secondary ? 'qb-btn-ghost' : 'xmf-button-text'} ${iconOnly ? 'qb-edit-icon' : 'qb-edit-mirror'}`}
      disabled={disabled} onClick={() => setOpen(value => !value)}>
      {!iconOnly && label}{icon}
    </button>
    {open && !disabled && anchor.current && <EditingMenu anchor={anchor.current} label={label} actions={actions} onClose={close} align={align} />}
  </>
}

function MirrorMenu({ disabled, placement }: { disabled?: boolean; placement?: boolean }) {
  const api = useEngine()
  const { lang } = useI18n()
  const s = mobileEditingStrings[lang]
  return <EditMenuButton label={s.mirror} icon={<ChevronDown size={14} aria-hidden="true" />} disabled={disabled} secondary={placement} align="center"
    actions={[
      { label: s.leftRight, icon: <FlipHorizontal2 />, run: () => api.mirror('lr') },
      { label: s.frontBack, icon: <FlipVertical2 />, run: () => api.mirror('fb') },
    ]} />
}

export function SelectionEditActions({ disabled }: { disabled?: boolean }) {
  const api = useEngine()
  const { lang } = useI18n()
  const s = mobileEditingStrings[lang]
  return <>
    <MirrorMenu disabled={disabled} />
    <button type="button" aria-label={s.copy} title={s.copy} disabled={disabled}
      className="qb-btn qb-btn-sm xmf-button-text qb-edit-icon" onClick={api.copy}>
      <Copy size={17} aria-hidden="true" />
    </button>
    <EditMenuButton label={s.more} icon={<Ellipsis size={18} aria-hidden="true" />} iconOnly disabled={disabled}
      actions={[
        { label: s.group, icon: <Group />, run: api.group, disabled: api.selectionCount < 2 },
        { label: s.ungroup, icon: <Ungroup />, run: api.ungroup, disabled: !api.selectionGroups },
        { label: s.remove, icon: <Trash2 />, run: api.deleteSel, count: api.selectionCount, divider: true },
      ]} />
  </>
}

export function PastePlacementPanel() {
  const api = useEngine()
  const { lang, t } = useI18n()
  const s = mobileEditingStrings[lang]
  const actualHeight = api.pasteHeightCm ?? 0
  const displayHeight = String(Number(actualHeight.toFixed(2)))
  const [height, setHeight] = useState(displayHeight)
  useEffect(() => setHeight(displayHeight), [displayHeight])
  return <section className="qb-card qb-transform-panel qb-paste-panel pointer-events-auto"
    data-ui="paste-placement" aria-label={s.placement}>
    <div className="qb-paste-heading">
      <strong>{s.placement}</strong>
      <label htmlFor="qb-paste-height">{s.height} <small>cm</small></label>
    </div>
    <div className="qb-paste-height">
      <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-label={s.lower}
        disabled={!api.canAdjustPasteHeight || actualHeight <= 0} onClick={() => api.nudgePasteY(-1)}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <input id="qb-paste-height" type="number" inputMode="decimal" min="0" step="any"
        value={height} disabled={!api.canAdjustPasteHeight} onChange={event => setHeight(event.target.value)}
        onBlur={event => {
          const next = event.target.valueAsNumber
          if (Number.isFinite(next) && next !== Number(displayHeight)) {
            const normalized = Math.max(0, next)
            setHeight(String(normalized))
            api.setPasteHeightCm(normalized)
          } else setHeight(displayHeight)
        }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-label={s.raise}
        disabled={!api.canAdjustPasteHeight} onClick={() => api.nudgePasteY(1)}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
    <div className="qb-paste-adjust">
      <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-label={s.turnLeft} onClick={() => api.rotate(-1)}>
        <RotateCcw size={16} aria-hidden="true" />90°
      </button>
      <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-label={s.turnRight} onClick={() => api.rotate(1)}>
        <RotateCw size={16} aria-hidden="true" />90°
      </button>
      <MirrorMenu placement />
    </div>
    <div className="qb-paste-footer">
      <button type="button" className="qb-btn qb-btn-sm xmf-button-text" onClick={api.cancelPaste}>{t('confirm.cancel')}</button>
      <button type="button" className="qb-btn qb-btn-sm" onClick={api.commitPaste}>{s.place}</button>
    </div>
  </section>
}
