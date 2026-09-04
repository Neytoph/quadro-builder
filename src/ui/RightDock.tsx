import { useI18n } from '../i18n'
import { HEIGHT_MIN, NARROW_MAX, PanelHandles, PANEL_GAP, TAB_BAR_H, usePanelLayout } from './panelLayout'
import { useDock, type DockPane } from './dock'
import FilePanel from './FilePanel'
import LibraryPanel from './LibraryPanel'
import SavesPanel from './SavesPanel'
import KitAdvisor from './KitAdvisor'
import { BomPane } from './PartsList'
import InventoryPane from './InventoryPane'

const TITLE: Record<DockPane, string> = {
  file: 'btn.file',
  library: 'lib.title',
  saves: 'saves.title',
  advisor: 'btn.advisor',
  bom: 'side.bom',
  inventory: 'side.inventory',
}

export default function RightDock() {
  const { pane, setPane } = useDock()
  const { t } = useI18n()
  const { right, vw, vh } = usePanelLayout()
  if (!pane) return null
  const narrow = vw <= NARROW_MAX
  const maxH = Math.max(HEIGHT_MIN, vh - right.top - PANEL_GAP)

  return (
    <aside
      data-tour="dock-panel"
      className="fixed z-[45] flex flex-col overflow-y-auto scrollbar-thin bg-gray-950/92 backdrop-blur border border-gray-800 rounded-2xl shadow-xl text-gray-200"
      style={narrow
        ? { left: PANEL_GAP, right: PANEL_GAP, top: TAB_BAR_H + PANEL_GAP, bottom: PANEL_GAP, width: 'auto', height: 'auto' }
        : { width: right.width, top: right.top, right: PANEL_GAP, maxHeight: maxH }}
    >
      <div className="sticky top-0 z-20 bg-gray-950/92 backdrop-blur">
        {!narrow && <PanelHandles side="right" hug moveLabel={t('hint.movePanel')} sizeLabel={t('hint.resize')} />}
        <div className="px-3 py-2 border-b border-gray-800 text-sm font-semibold shrink-0 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate">{t(TITLE[pane])}</span>
          <button onClick={() => setPane(null)}
            className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 cursor-pointer text-lg leading-none"
            aria-label="Close">×</button>
        </div>
      </div>
      {pane === 'file' && <FilePanel />}
      {pane === 'library' && <LibraryPanel />}
      {pane === 'saves' && <SavesPanel />}
      {pane === 'advisor' && <KitAdvisor />}
      {pane === 'bom' && <BomPane />}
      {pane === 'inventory' && <InventoryPane />}
    </aside>
  )
}
