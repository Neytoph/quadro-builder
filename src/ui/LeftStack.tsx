import { useLayoutEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { leftColumnWidth, leftStackDrop, PanelHandles, PANEL_GAP, TOOLBAR_CHROME_H, toolbarTop, usePanelLayout } from './panelLayout'
import SideToolbar from './SideToolbar'
import ShortcutHint from './ShortcutHint'

/** 左侧颜色 + 快捷键同一栏：等宽、可拖宽度、箭头整行收起。 */
export default function LeftStack() {
  const { t } = useI18n()
  const { left, vw, vh, toolbarW, leftColor, leftKeys, toggleLeftColor, toggleLeftKeys, setLeftBottom } = usePanelLayout()
  const drop = leftStackDrop(left, vw, toolbarW)
  const top = drop
    ? toolbarTop(left, vw) + TOOLBAR_CHROME_H + PANEL_GAP
    : left.top
  const width = leftColumnWidth(left, vw)
  const maxH = Math.max(80, vh - top - PANEL_GAP)

  // 这一栏实际到哪儿：卡片收起、展开会变高变矮，挪位置、改窗口大小会整栏上下移
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setLeftBottom(el.getBoundingClientRect().bottom)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [top, maxH, setLeftBottom])

  return (
    <aside
      ref={ref}
      data-ui="left-stack"
      data-tour="left-color"
      className="fixed z-30 flex flex-col gap-2 min-h-0 overflow-y-auto scrollbar-thin"
      style={{ top, left: PANEL_GAP, width, maxHeight: maxH }}
    >
      <PanelHandles
        side="left"
        hug
        showMove={!drop}
        moveLabel={t('hint.movePanel')}
        sizeLabel={t('hint.resize')}
      />
      <SideToolbar open={leftColor} onToggle={toggleLeftColor} />
      <ShortcutHint open={leftKeys} onToggle={toggleLeftKeys} />
    </aside>
  )
}
