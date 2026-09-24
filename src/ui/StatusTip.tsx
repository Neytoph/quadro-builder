import { useEffect, useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { leftColumnWidth, NARROW_MAX, PANEL_GAP, usePanelLayout } from './panelLayout'
import { useDock } from './dock'
import { usePresence } from './motion'

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
/** 小麦那张图画出来多高：宽 96，连头顶的想法泡泡一起 */
const MIAO_H = 150
/** 趴在左栏底下的时候，头顶跟左栏之间至少空出这么多，不挤在一起 */
const MIAO_GAP = 40

/**
 * 屏幕左下角趴着小麦：左栏底下放得下，就趴在左栏底下，跟左栏左边齐平；
 * 左栏长到底下放不下（窗口矮、卡片都展开），就趴在左栏右边。换地方的时候滑过去。
 * 换工具的时候它弹出一个对话框，说当前工具怎么用，停几秒收起来。
 * 手机上没有小麦，只弹那句话，贴在拼装条上面。
 * 小麦那张图带着 data-ui="miao"：嵌在站点里的时候，站点拿它当小麦客服的入口。
 */
export default function StatusTip() {
  const api = useEngine()
  const { t } = useI18n()
  const { left, vw, vh, leftBottom } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const { pane } = useDock()
  const key = api.pasting ? 'status.paste'
    : api.placingConnector ? 'tip.placeConnector'
    : api.assembly.active ? 'status.assembly'
    : (BY_MODE[api.mode] || 'tip.select')
  const text = t(key, { h: api.pasteHeightCm ?? 0 })

  // 换了一句就弹出来，停 SAY_MS 收起
  const [say, setSay] = useState<string | null>(text)
  useEffect(() => {
    setSay(text)
    const id = window.setTimeout(() => setSay(null), SAY_MS)
    return () => window.clearTimeout(id)
  }, [text])
  const [shown, leaving] = usePresence(say)

  if (narrow && pane) return null
  // 电脑上是对话框，左边一个小尖角指着小麦；手机上没有小麦，就是一条提示
  const bubble = shown && (
    <p key={key} className={`m-say qb-card text-gray-100 ${leaving ? 'm-leave' : ''} ${narrow
      ? 'max-w-full px-3 py-1.5 text-[12px] leading-snug truncate'
      : 'qb-say mb-16 px-3.5 py-2 max-w-[19rem] text-[12.5px] leading-[1.55]'}`}>{shown}</p>
  )

  if (narrow) {
    return (
      <div className="fixed left-2 right-2 bottom-[68px] z-30 pointer-events-none flex justify-center">
        {bubble}
      </div>
    )
  }
  const under = leftBottom > 0 && leftBottom + MIAO_GAP + MIAO_H + PANEL_GAP <= vh
  return (
    <div data-ui="status-tip" data-spot={under ? 'under' : 'beside'}
      className="m-slide fixed bottom-3 z-30 flex items-end gap-2.5 pointer-events-none"
      style={{ left: under ? PANEL_GAP : PANEL_GAP + leftColumnWidth(left, vw) + PANEL_GAP }}>
      <img data-ui="miao" src={`${import.meta.env.BASE_URL}ui/miao-tip.png`} alt="" width={96} draggable={false}
        className="w-24 h-auto select-none" />
      {bubble}
    </div>
  )
}
