import { useI18n } from '../i18n'
import { leftColumnWidth, NARROW_MAX, PanelHandles, PANEL_GAP, TOOLBAR_H, TOP_MIN, usePanelLayout } from './panelLayout'
import SideToolbar from './SideToolbar'
import ShortcutHint from './ShortcutHint'

/** 左侧颜色 + 快捷键同一栏：等宽、可拖宽度、箭头整行收起。 */
export default function LeftStack() {
  const { t } = useI18n()
  const { left, vw, vh, leftColor, leftKeys, toggleLeftColor, toggleLeftKeys } = usePanelLayout()
  const narrow = vw <= NARROW_MAX
  const top = narrow ? TOP_MIN + TOOLBAR_H + PANEL_GAP : left.top
  const width = leftColumnWidth(left, vw)
  const maxH = Math.max(80, vh - top - PANEL_GAP)

  return (
    <aside
      data-ui="left-stack"
      className="fixed z-30 flex flex-col gap-2 min-h-0 overflow-y-auto scrollbar-thin"
      style={{ top, left: PANEL_GAP, width, maxHeight: maxH }}
    >
      <PanelHandles
        side="left"
        hug
        showMove={!narrow}
        moveLabel={t('hint.movePanel')}
        sizeLabel={t('hint.resize')}
      />
      <SideToolbar open={leftColor} onToggle={toggleLeftColor} />
      <ShortcutHint open={leftKeys} onToggle={toggleLeftKeys} />
    </aside>
  )
}
