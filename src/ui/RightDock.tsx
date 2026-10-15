import { useI18n } from '../i18n'
import { useEngine } from '../store/EngineContext'
import { NARROW_MAX, PanelHandles, PANEL_GAP, TOOLBAR_CHROME_H, toolbarTop, usePanelLayout } from './panelLayout'
import { useDock, type DockPane } from './dock'
import FilePanel from './FilePanel'
import LibraryPanel from './LibraryPanel'
import SavesPanel from './SavesPanel'
import KitAdvisor from './KitAdvisor'
import { BomPane } from './PartsList'
import InventoryPane from './InventoryPane'
import SafetyPane from './SafetyPane'
import { usePresence } from './motion'
import { useCollab } from '../collab/CollabContext'
import CommentsPane from '../collab/ui/CommentsPane'
import VersionsPane from '../collab/ui/VersionsPane'
import { X } from 'lucide-react'
import { DockIcon } from './DockIcon'

const TITLE: Record<DockPane, string> = {
  file: 'btn.file',
  library: 'lib.title',
  saves: 'saves.title',
  advisor: 'btn.advisor',
  bom: 'side.bom',
  inventory: 'side.inventory',
  safety: 'safety.title',
  comments: 'collab.pane.commentsTitle',
  versions: 'collab.pane.versions',
}

export default function RightDock() {
  const { pane: open, setPane } = useDock()
  const api = useEngine()
  const collab = useCollab()
  // 评论和版本只属于共享方案：切到自己的标签页就不显示
  const live = (open === 'comments' || open === 'versions') && collab.mode !== 'plan' ? null : open
  const { t } = useI18n()
  const { right, left, vw, vh, toolbarW } = usePanelLayout()
  const [pane, leaving] = usePresence(live)
  if (!pane) return null
  const narrow = vw <= NARROW_MAX
  // 面板宽到够着居中的工具条时，往下让到工具条底下，标题不被挡住
  const toolbarRight = (vw + toolbarW) / 2
  const clash = vw - PANEL_GAP - right.width < toolbarRight + PANEL_GAP
  const toolbarBottom = toolbarTop(left, vw) + TOOLBAR_CHROME_H + PANEL_GAP
  let top = right.top
  if (narrow) top = toolbarBottom
  else if (clash) top = Math.max(right.top, toolbarBottom)
  const maxH = Math.max(0, vh - top - PANEL_GAP)
  const width = narrow ? Math.min(right.width, Math.max(0, vw - PANEL_GAP * 2)) : right.width
  const visibleBox = { ...right, top, height: Math.min(right.height, maxH) }
  const name = api.tabs.find(tab => tab.tabId === api.activeTabId)?.name || t('tab.untitled')
  const close = () => {
    setPane(null)
    document.querySelector<HTMLButtonElement>(`[data-pane="${pane}"]`)?.focus()
  }

  return (
    <aside
      data-tour="dock-panel"
      data-ui="right-dock"
      id="qb-right-dock" aria-labelledby="qb-dock-title"
      data-pane={pane}
      className={`m-dock qb-right-dock fixed ${narrow ? 'z-[60]' : 'z-[45]'} flex flex-col qb-card text-gray-200 ${leaving ? 'm-leave pointer-events-none' : ''}`}
      style={{ width, top, right: PANEL_GAP, height: Math.min(right.height, maxH), maxHeight: maxH }}
    >
      {!narrow && <PanelHandles side="right" boxOverride={visibleBox} showMove={false} moveLabel={t('hint.movePanel')} sizeLabel={t('hint.resize')} />}
      <div className="qb-dock-header">
        {!narrow && <PanelHandles side="right" boxOverride={visibleBox} hug showResize={false} moveLabel={t('hint.movePanel')} sizeLabel={t('hint.resize')} />}
        <div className="qb-dock-heading">
          <span className="qb-dock-icon"><DockIcon pane={pane} size={21} /></span>
          <div key={pane} className="m-swap qb-dock-title-copy"><h1 id="qb-dock-title">{t(TITLE[pane])}</h1><p title={name}>{name}</p></div>
          <button onClick={close} className="qb-dock-control" aria-label={t('chrome.close')} title={t('chrome.close')}><X size={19} aria-hidden="true" /></button>
        </div>
      </div>
      {/* 换面板时内容整块换掉，key 让它重新演一遍入场。
          不能收缩：面板里有 sticky 的表头，父级被压矮之后它就粘不住了。 */}
      <div className="qb-dock-scroll scrollbar-thin">
      <div key={pane} className="m-swap flex flex-col shrink-0">
        {pane === 'file' && <FilePanel />}
        {pane === 'library' && <LibraryPanel />}
        {pane === 'saves' && <SavesPanel />}
        {pane === 'advisor' && <KitAdvisor />}
        {pane === 'bom' && <BomPane />}
        {pane === 'inventory' && <InventoryPane />}
        {pane === 'safety' && <SafetyPane />}
        {pane === 'comments' && <CommentsPane />}
        {pane === 'versions' && <VersionsPane />}
      </div>
      </div>
    </aside>
  )
}
