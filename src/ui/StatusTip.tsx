import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { NARROW_MAX, statusTipBox, usePanelLayout } from './panelLayout'
import { useDock } from './dock'
import { usePresence } from './motion'
import { componentForTool } from '../store/builderComponents'
import { useMobileControls } from './useMobileControls'
import FlexiGuide from './FlexiGuide'

const BY_MODE: Record<string, string> = {
  select: 'tip.select',
  delete: 'status.delete',
  add: 'status.add',
  panel: 'status.panel',
  slide: 'status.slide',
  fitting: 'status.fitting',
  clamp: 'status.clamp',
  c45: 'status.c45',
  reinforce: 'status.reinforce',
  assembly: 'status.assembly',
}

/** 一句话在画面上停多久。说完就收起来，不一直压着画布。 */
const SAY_MS = 6000
const KEYBOARD_TIPS = new Set(['tip.select', 'status.delete', 'status.clamp', 'status.assembly', 'status.paste'])

/**
 * 工具提示：换工具的时候弹出一句当前工具怎么用，停几秒收起来。
 * 电脑上在工具条正下方（摆在哪儿见 panelLayout 的 statusTipBox），从工具条底下落出来，收起的时候折回去；
 * 手机上贴在拼装条上面，从下往上冒。
 * 工具条的下拉菜单开着、或者正弹着别的提示条的时候先收起来，那两样也出在工具条底下；
 * 菜单关上再弹一遍，选完零件正好看见接下来怎么点。
 */
export default function StatusTip({ menuOpen }: { menuOpen: boolean }) {
  const api = useEngine()
  const mobile = useMobileControls()
  const { t } = useI18n()
  const { left, right, vw, toolbarW } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const { pane } = useDock()
  const adjustment = api.engine()?.builder.selectedPartAdjustment()
  const adjusting = !!adjustment
  const key = api.pasting ? 'status.paste'
    : api.placingConnector ? 'tip.placeConnector'
    : api.assembly.active ? 'status.assembly'
    : adjusting ? 'tip.adjustSelected'
    : (BY_MODE[api.mode] || 'tip.select')
  const text = t(key, { h: api.pasteHeightCm ?? 0 })

  const [say, setSay] = useState<string | null>(text)
  useEffect(() => {
    if (menuOpen) {
      setSay(null)
      return
    }
    setSay(text)
    const id = window.setTimeout(() => setSay(null), SAY_MS)
    return () => window.clearTimeout(id)
  }, [text, menuOpen])
  const [shown, leaving] = usePresence(api.toast ? null : say)

  const flexi = (api.mode === 'fitting' && ['flexi', 'flexi_bolt', 'flexi_hinge'].includes(api.fittingKind))
    || (api.mode === 'select' && !!api.engine()?.builder.flexiTarget())
  if (flexi && !menuOpen && !api.readOnly) {
    const box = narrow ? { left: 8, right: 8, bottom: 68 } : statusTipBox(left, vw, toolbarW, pane ? right : null)
    if (!box || (narrow && pane)) return null
    return <div data-ui="flexi-guide" className="fixed z-40 flex justify-center pointer-events-none" style={box}><FlexiGuide /></div>
  }

  if (adjustment === 'panel' && !menuOpen && !api.toast && !api.canFlipAccessory && !api.installationPreview && !componentForTool(api)) {
    const box = narrow ? { left: 8, right: 8, bottom: 68 } : statusTipBox(left, vw, toolbarW, pane ? right : null)
    if (!box || (narrow && pane)) return null
    return <div data-ui="panel-adjustment" className="fixed z-40 flex justify-center pointer-events-none" style={box}>
      <div className="qb-card qb-flexi-guide qb-flexi-actions">
        <span>{t('tip.adjustPanel')}</span>
        <button type="button" onClick={() => { api.engine()?.builder.turnSelectedPanel(); api.bump() }}>{t('tip.turnPanel')}</button>
      </div>
    </div>
  }

  if ((mobile && KEYBOARD_TIPS.has(key)) || api.installationPreview || api.canFlipAccessory || componentForTool(api)) return null

  if (narrow && pane) return null
  if (narrow) {
    return (
      <div data-ui="status-tip" className="fixed left-2 right-2 bottom-[68px] z-30 pointer-events-none flex justify-center">
        {shown && (
          <p key={key} className={`m-say m-say-up qb-card text-gray-100 max-w-full px-3 py-1.5 text-[12px] leading-snug truncate ${leaving ? 'm-leave' : ''}`}>
            {shown}
          </p>
        )}
      </div>
    )
  }
  const box = statusTipBox(left, vw, toolbarW, pane ? right : null)
  if (!box) return null
  return (
    <div data-ui="status-tip" className="fixed z-30 pointer-events-none flex justify-center" style={box}>
      {shown && (
        <p key={key} className={`m-say qb-card text-gray-100 max-w-full px-4 py-2 text-[12.5px] leading-[1.55] text-center ${leaving ? 'm-leave' : ''}`}>
          {shown}
        </p>
      )}
    </div>
  )
}
