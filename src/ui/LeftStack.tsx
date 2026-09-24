import { useI18n } from '../i18n'
import { leftColumnWidth, leftStackDrop, PanelHandles, PANEL_GAP, TOOLBAR_CHROME_H, toolbarTop, usePanelLayout } from './panelLayout'
import SideToolbar from './SideToolbar'
import ShortcutHint from './ShortcutHint'

/** 左侧颜色 + 快捷键同一栏：等宽、可拖宽度、箭头整行收起。 */
export default function LeftStack() {
  const { t } = useI18n()
  const { left, vw, vh, toolbarW, leftColor, leftKeys, toggleLeftColor, toggleLeftKeys } = usePanelLayout()
  const drop = leftStackDrop(left, vw, toolbarW)
  const top = drop
    ? toolbarTop(left, vw) + TOOLBAR_CHROME_H + PANEL_GAP
    : left.top
  const width = leftColumnWidth(left, vw)
  const maxH = Math.max(80, vh - top - PANEL_GAP)

  return (
    <aside
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
