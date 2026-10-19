import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HexColorPicker } from 'react-colorful'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { normalizeColor } from '../engine/customColors.js'
import { colorStrings } from './colorStrings'

export default function CustomColorPicker({ initial, anchor, selected, onPreview, onFinish }: {
  initial: string
  anchor: DOMRect
  selected: boolean
  onPreview: (hex: string) => void
  onFinish: (hex?: string) => void
}) {
  const { lang } = useI18n()
  const s = colorStrings[lang]
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const callbacks = useRef({ onPreview, onFinish })
  callbacks.current = { onPreview, onFinish }
  const [hex, setHex] = useState(initial)
  const [text, setText] = useState(initial)
  const valid = normalizeColor(text)

  useLayoutEffect(() => {
    const el = dialog.current!
    el.showModal()
    const place = () => {
      el.style.left = `${Math.max(8, Math.min(anchor.right + 12, window.innerWidth - el.offsetWidth - 8))}px`
      el.style.top = `${Math.max(8, Math.min(anchor.top - 24, window.innerHeight - el.offsetHeight - 12))}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place); el.close() }
  }, [anchor])

  useEffect(() => {
    const frame = requestAnimationFrame(() => callbacks.current.onPreview(hex))
    return () => cancelAnimationFrame(frame)
  }, [hex])

  useEffect(() => {
    const root = dialog.current!
    const saturation = root.querySelector<HTMLElement>('.react-colorful__saturation [role="slider"]')
    const hue = root.querySelector<HTMLElement>('.react-colorful__hue [role="slider"]')
    saturation?.setAttribute('aria-label', s.saturation)
    hue?.setAttribute('aria-label', s.hue)
  }, [s])

  const pick = (value: string) => { const next = normalizeColor(value)!; setHex(next); setText(next) }

  return createPortal(<dialog ref={dialog} className="qb-color-dialog" role="dialog" aria-modal="true" aria-labelledby="qb-color-title"
    onCancel={event => { event.preventDefault(); onFinish() }}
    onKeyDown={event => event.stopPropagation()}
    onPointerDown={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onFinish()
    } }}>
    <form onSubmit={event => { event.preventDefault(); if (valid) onFinish(valid) }}>
      <div className="qb-color-dialog-heading"><div><p>{s.custom}</p><h2 id="qb-color-title">{s.title}</h2></div>
        <button type="button" className="qb-color-close" aria-label={s.close} onClick={() => onFinish()}><X size={18} /></button>
      </div>
      <p className="qb-color-help">{selected ? s.selected : s.next}</p>
      <HexColorPicker color={hex} onChange={pick} />
      <div className="qb-color-fields">
        <label className="qb-color-hex"><span>{s.hex}</span><input ref={field} autoFocus value={text} spellCheck={false} autoComplete="off"
          aria-invalid={!valid} aria-describedby={!valid ? 'qb-color-error' : undefined}
          onChange={event => { setText(event.target.value); const next = normalizeColor(event.target.value); if (next) setHex(next) }}
          onBlur={() => { if (valid) setText(valid) }} /></label>
        <div className="qb-color-sample"><span style={{ background: initial }} /><small>{s.before}</small></div>
        <div className="qb-color-sample"><span style={{ background: hex }} /><small>{s.after}</small></div>
      </div>
      {!valid && <p id="qb-color-error" role="alert" className="qb-color-error">{s.invalid}</p>}
      <div className="qb-color-actions"><button type="button" className="qb-color-secondary xmf-button xmf-button-text" onClick={() => onFinish()}>{s.cancel}</button>
        <button type="submit" className="qb-btn" disabled={!valid}>{s.apply}</button></div>
    </form>
  </dialog>, document.body)
}
