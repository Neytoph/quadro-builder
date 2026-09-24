import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { BuildModel, SceneManager } from '../../engine-api'
import { MOTION } from '../../ui/motion'
import { DIFF_COLORS, useCollab } from '../CollabContext'
import type { ModelJSON } from '../ymodel'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any

/** 一边的画面：自己的场景和模型，按零件上色。 */
function useSide(host: React.RefObject<HTMLDivElement | null>, json: ModelJSON | null, tints: Map<string, string>) {
  const ref = useRef<{ scene: E; model: E } | null>(null)
  useEffect(() => {
    if (!host.current) return
    const scene = new SceneManager(host.current)
    scene.setMotion(MOTION)
    scene.setTheme(false)
    scene.setScene(false)
    scene.releaseLoadGate()
    const model = new BuildModel()
    ref.current = { scene, model }
    return () => { scene.dispose(); ref.current = null }
  }, [host])
  useEffect(() => {
    const s = ref.current
    if (!s || !json) return
    const res = s.model.loadJSON(json)
    if (!res.ok) throw new Error(`compare: model does not load (${res.reason})`)
    const draw = () => { s.scene.renderModel(s.model, null, { tints, dimUntinted: true }); s.scene.requestRender() }
    s.scene.onMeshesReady = draw
    draw()
  }, [json, tints])
  return ref
}

/**
 * 版本对照：左右两个画面，镜头一起转。左边是旧的，删掉的零件标红；右边是新的，
 * 加上的标绿；两边都有但挪过、换过颜色的标橙。底下列出料表里数量变了的行。
 */
export default function CompareView() {
  const collab = useCollab()
  const { t } = useI18n()
  const cmp = collab.compare
  const leftHost = useRef<HTMLDivElement>(null)
  const rightHost = useRef<HTMLDivElement>(null)

  const leftTints = new Map<string, string>()
  const rightTints = new Map<string, string>()
  if (cmp) {
    for (const id of cmp.diff.removed) leftTints.set(id, DIFF_COLORS.removed)
    for (const id of cmp.diff.added) rightTints.set(id, DIFF_COLORS.added)
    for (const id of cmp.diff.changed) { leftTints.set(id, DIFF_COLORS.changed); rightTints.set(id, DIFF_COLORS.changed) }
  }
  const tintKey = cmp ? `${[...cmp.diff.removed].join()}|${[...cmp.diff.added].join()}|${[...cmp.diff.changed].join()}` : ''
  const lt = useRef(leftTints)
  const rt = useRef(rightTints)
  const lastKey = useRef('')
  if (lastKey.current !== tintKey) { lt.current = leftTints; rt.current = rightTints; lastKey.current = tintKey }

  const left = useSide(leftHost, cmp?.left || null, lt.current)
  const right = useSide(rightHost, cmp?.right || null, rt.current)

  // 两边镜头同步：谁动了就把谁的镜头给另一边
  const framed = useRef(false)
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const a = left.current, b = right.current
      if (!a || !b) return
      // 两边画布都有了尺寸再框：按大的那一座框住，另一边照抄
      if (!framed.current && cmp && leftHost.current?.clientWidth && rightHost.current?.clientWidth) {
        framed.current = true
        a.scene.onResize()
        b.scene.onResize()
        const size = (m: E) => { const bb = m.bounds(2.5); return bb ? bb.size[0] * bb.size[1] * bb.size[2] + bb.size[0] + bb.size[2] : 0 }
        const big = size(a.model) > size(b.model) ? a : b
        big.scene.resetCamera(big.model, { animate: false })
        const pose = big.scene.getCameraPose()
        a.scene.setCameraPose(pose)
        b.scene.setCameraPose(pose)
      }
      const pa = JSON.stringify(a.scene.getCameraPose())
      const pb = JSON.stringify(b.scene.getCameraPose())
      if (pa === pb) { last = pa; return }
      if (pa !== last) { b.scene.setCameraPose(JSON.parse(pa)); last = pa }
      else { a.scene.setCameraPose(JSON.parse(pb)); last = pb }
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [left, right, cmp])

  if (!cmp) return null
  const counts = { added: cmp.diff.added.size, removed: cmp.diff.removed.size, changed: cmp.diff.changed.size }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-950" data-ui="compare-view">
      <div className="flex items-center gap-3 px-3 h-12 border-b border-gray-800 shrink-0">
        <div className="text-sm font-semibold text-gray-100">{t('collab.compare.title')}</div>
        <div className="flex items-center gap-3 text-xs text-gray-300">
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full" style={{ background: DIFF_COLORS.added }} />{t('collab.compare.added', { n: counts.added })}</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full" style={{ background: DIFF_COLORS.removed }} />{t('collab.compare.removed', { n: counts.removed })}</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full" style={{ background: DIFF_COLORS.changed }} />{t('collab.compare.changed', { n: counts.changed })}</span>
        </div>
        <span className="flex-1" />
        <button onClick={collab.closeCompare} className="qb-btn qb-btn-ghost qb-btn-sm" data-ui="compare-close">{t('collab.compare.close')}</button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-gray-800">
        {[{ host: leftHost, name: cmp.names[0], side: 'left' }, { host: rightHost, name: cmp.names[1], side: 'right' }].map(s => (
          <div key={s.side} className="relative bg-gray-950 min-w-0 min-h-0 overflow-hidden">
            <div ref={s.host} className="qb-compare-host absolute inset-0" data-ui={`compare-${s.side}`} />
            <div className="qb-card absolute top-2 left-2 px-2.5 py-1 text-xs text-gray-100 pointer-events-none">{s.name}</div>
          </div>
        ))}
      </div>
      <div className="shrink-0 max-h-[34vh] overflow-y-auto border-t border-gray-800 bg-gray-950 px-3 py-2" data-ui="compare-bom">
        <div className="text-xs font-semibold text-gray-200 mb-1.5">{t('collab.compare.bom')}</div>
        {!cmp.bom.length && <div className="text-xs text-gray-400">{t('collab.compare.bomSame')}</div>}
        {cmp.bom.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left">
              <th className="font-normal py-1">{t('collab.compare.part')}</th>
              <th className="font-normal py-1 text-right">{cmp.names[0]}</th>
              <th className="font-normal py-1 text-right">{cmp.names[1]}</th>
              <th className="font-normal py-1 text-right">{t('collab.compare.delta')}</th>
            </tr></thead>
            <tbody>
              {cmp.bom.map(r => {
                const d = r.right - r.left
                return (
                  <tr key={r.key} className="border-t border-gray-800 text-gray-100">
                    <td className="py-1">{r.name}{r.color ? <span className="text-gray-400"> · {r.color}</span> : null}</td>
                    <td className="py-1 text-right qb-num">{r.left}</td>
                    <td className="py-1 text-right qb-num">{r.right}</td>
                    <td className="py-1 text-right qb-num font-semibold" style={{ color: d > 0 ? DIFF_COLORS.added : DIFF_COLORS.removed }}>{d > 0 ? `+${d}` : d}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
