import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import './ModelOpening.css'

export type OpeningPhase = 'prepare' | 'read' | 'build'
export interface ModelOpeningState { phase: OpeningPhase; name?: string }

// 留出一次浏览器绘制，让同步解析和场景构建前的提示真正出现在画面上。
export function paintOpening() {
  return new Promise<void>(resolve => {
    const timer = window.setTimeout(done, 80)
    const frame = requestAnimationFrame(() => window.setTimeout(done, 0))
    function done() { window.clearTimeout(timer); cancelAnimationFrame(frame); resolve() }
  })
}

const words = {
  zh: {
    title: '正在打开造型', prepare: '准备三维工作区', read: '读取造型内容', build: '准备零件与画面',
    body: '把每一根管、每一块板，放回它们的位置。',
    slow: '这次准备需要多一点时间，复杂造型或首次打开可能较慢，请稍候。',
    tip: '打开后，拖动画面旋转，滚轮缩放。', touch: '打开后，单指旋转，双指缩放。',
  },
  en: {
    title: 'Opening your design', prepare: 'Preparing the 3D workspace', read: 'Reading the design', build: 'Preparing parts and the scene',
    body: 'Putting every tube and panel back in place.',
    slow: 'This is taking a little longer. Complex designs and first visits may need more time. Please wait.',
    tip: 'Once open, drag to rotate and scroll to zoom.', touch: 'Once open, rotate with one finger and pinch to zoom.',
  },
  de: {
    title: 'Dein Modell wird geöffnet', prepare: '3D-Arbeitsbereich vorbereiten', read: 'Modell einlesen', build: 'Bauteile und Ansicht vorbereiten',
    body: 'Jedes Rohr und jede Platte kommt an seinen Platz.',
    slow: 'Es dauert etwas länger. Komplexe Modelle und der erste Aufruf können mehr Zeit benötigen. Bitte warte kurz.',
    tip: 'Danach: Ziehen zum Drehen, Mausrad zum Zoomen.', touch: 'Danach: Mit einem Finger drehen, mit zwei Fingern zoomen.',
  },
}

export default function ModelOpening({ phase, name }: ModelOpeningState) {
  const { lang } = useI18n()
  const text = words[lang]
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12000)
    return () => window.clearTimeout(timer)
  }, [])
  const steps: OpeningPhase[] = ['prepare', 'read', 'build']
  const current = steps.indexOf(phase)
  return <div className="model-opening" data-ui="model-opening" aria-busy="true">
    <div className="model-opening-card">
      <div className="model-opening-mark" aria-hidden="true"><i /><i /><i /></div>
      <h2>{text.title}<span aria-hidden="true">…</span></h2>
      {name && <p className="model-opening-name">{name}</p>}
      <p className="model-opening-status" role="status" aria-live="polite">{text[phase]}</p>
      <div className="model-opening-track" aria-hidden="true">{steps.map((step, i) => <span key={step} data-state={i < current ? 'done' : i === current ? 'active' : 'pending'} />)}</div>
      <p className="model-opening-body">{slow ? text.slow : text.body}</p>
      <p className="model-opening-tip"><span className="model-opening-mouse">{text.tip}</span><span className="model-opening-touch">{text.touch}</span></p>
    </div>
  </div>
}
