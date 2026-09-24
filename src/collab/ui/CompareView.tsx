import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n'
import { BuildModel, SceneManager } from '../../engine-api'
import { MOTION } from '../../ui/motion'
import { DIFF_COLORS, useCollab } from '../CollabContext'
import type { ModelJSON } from '../ymodel'
import { day } from './bits'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any

/** 一边的画面：自己的场景和模型；上了色的零件突出，其余退后。 */
function useSide(host: React.RefObject<HTMLDivElement | null>, json: ModelJSON, tints: Map<string, string>) {
  const ref = useRef<{ scene: E; model: E } | null>(null)
  useEffect(() => {
    if (!host.current) throw new Error('compare: no host')
    const scene = new SceneManager(host.current)
    scene.setMotion(MOTION)
    scene.setTheme(false)
    scene.setScene(false)
    scene.releaseLoadGate()
    ref.current = { scene, model: new BuildModel() }
    return () => { scene.dispose(); ref.current = null }
  }, [host])
  useEffect(() => {
    const s = ref.current
    if (!s) return
    const res = s.model.loadJSON(json)
    if (!res.ok) throw new Error(`compare: model does not load (${res.reason})`)
    const draw = () => { s.scene.renderModel(s.model, null, { tints, dimUntinted: true }); s.scene.requestRender() }
    s.scene.onMeshesReady = draw
    draw()
  }, [json, tints])
  return ref
}

/**
 * 版本对照：顶上一条选两版和图例；下面左右两个画面，镜头一起转，左边旧版里去掉的零件
 * 标红，右边新版里加上的标绿（挪过位置的零件两边都标）；底部料表差异，只列变了的。
 */
export default function CompareView() {
  const collab = useCollab()
  const { t, lang } = useI18n()
  const cmp = collab.compare!
  const leftHost = useRef<HTMLDivElement>(null)
  const rightHost = useRef<HTMLDivElement>(null)

  const { lt, rt, removed, added } = useMemo(() => {
    const lt = new Map<string, string>(), rt = new Map<string, string>()
    for (const id of cmp.diff.removed) lt.set(id, DIFF_COLORS.removed)
    for (const id of cmp.diff.added) rt.set(id, DIFF_COLORS.added)
    for (const id of cmp.diff.changed) { lt.set(id, DIFF_COLORS.removed); rt.set(id, DIFF_COLORS.added) }
    return { lt, rt, removed: lt.size, added: rt.size }
  }, [cmp])

  const left = useSide(leftHost, cmp.left, lt)
  const right = useSide(rightHost, cmp.right, rt)

  // 两边都有了尺寸再框：按大的那一座框住；之后谁动了就把谁的镜头给另一边
  const framed = useRef(false)
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const a = left.current, b = right.current
      if (!a || !b) return
      if (!framed.current && leftHost.current?.clientWidth && rightHost.current?.clientWidth) {
        framed.current = true
        a.scene.onResize()
        b.scene.onResize()
        const size = (m: E) => { const bb = m.bounds(2.5); return bb ? bb.size[0] + bb.size[1] + bb.size[2] : 0 }
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
  }, [left, right])

  // 两个下拉：现在、各版本、参考方案
  const options = [
    { id: 'current', name: t('collab.version.now'), at: null as number | null },
    ...collab.versions.filter(v => v.kind !== 'reference').sort((a, b) => b.createdAt - a.createdAt).map(v => ({ id: String(v.id), name: v.name, at: v.createdAt })),
    ...collab.versions.filter(v => v.kind === 'reference').map(v => ({ id: String(v.id), name: t('collab.version.reference'), at: v.createdAt })),
  ]
  for (const id of cmp.ids) if (!options.some(o => o.id === id)) options.push({ id, name: cmp.names[cmp.ids.indexOf(id)], at: null })
  const count = (json: ModelJSON) => ['tubes', 'panels', 'slides', 'fittings'].reduce((s, k) => s + ((json[k] as unknown[] | undefined)?.length || 0), 0)

  const Select = ({ side }: { side: 0 | 1 }) => {
    const id = cmp.ids[side]
    const o = options.find(x => x.id === id)
    return (
      <span className="cb-vsel" data-ui={`compare-pick-${side}`}>
        {cmp.names[side]}{o?.at ? <small>{day(o.at, lang)}</small> : null}<ChevronDown />
        <select value={id} aria-label={cmp.names[side]} onChange={e => {
          const ids: [string, string] = side === 0 ? [e.target.value, cmp.ids[1]] : [cmp.ids[0], e.target.value]
          collab.openCompare(ids[0], ids[1])
        }}>
          {options.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </span>
    )
  }

  return (
    <div className="cb-compare" data-ui="compare-view">
      <div className="cb-cmpbar qb-card">
        <Select side={0} />
        <span className="cb-legend">→</span>
        <Select side={1} />
        <span className="cb-legend"><i className="r" />{t('collab.compare.removed', { n: removed })}</span>
        <span className="cb-legend"><i className="a" />{t('collab.compare.added', { n: added })}</span>
        <button type="button" className="qb-btn qb-btn-ghost qb-btn-sm sp" onClick={collab.closeCompare} data-ui="compare-close">{t('collab.compare.close')}</button>
      </div>
      <div className="cb-panes">
        {[{ host: leftHost, name: cmp.names[0], side: 'left' }, { host: rightHost, name: cmp.names[1], side: 'right' }].map(s => (
          <div key={s.side} className="cb-cpane">
            <div ref={s.host} className="host" data-ui={`compare-${s.side}`} />
            <span className="lb">{s.name}</span>
            <span className="sync">{t('collab.compare.synced')}</span>
          </div>
        ))}
      </div>
      <div className="cb-diff qb-card" data-ui="compare-bom">
        <div className="dh"><b>{t('collab.compare.bom')}</b>
          <span>{t('collab.compare.totals', { a: cmp.names[0], n: count(cmp.left), b: cmp.names[1], m: count(cmp.right) })}</span></div>
        <div className="tb">
          {!cmp.bom.length && <div className="cb-hint" style={{ padding: 0 }}>{t('collab.compare.bomSame')}</div>}
          {cmp.bom.length > 0 && (
            <table>
              <thead><tr><th>{t('collab.compare.part')}</th><th>{cmp.names[0]}</th><th>{cmp.names[1]}</th><th>{t('collab.compare.delta')}</th></tr></thead>
              <tbody>
                {cmp.bom.map(r => {
                  const d = r.right - r.left
                  return (
                    <tr key={r.key}>
                      <td>{r.name}{r.color ? ` · ${r.color}` : ''}</td>
                      <td>{r.left}</td>
                      <td>{r.right}</td>
                      <td className={d > 0 ? 'a' : 'r'}>{d > 0 ? `+${d}` : `−${-d}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
