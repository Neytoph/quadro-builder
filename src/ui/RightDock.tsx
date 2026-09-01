import { useI18n } from '../i18n'
import { PanelHandles, panelStyle, usePanelLayout } from './panelLayout'
import { useDock, type DockPane } from './dock'
import FilePanel from './FilePanel'
import LibraryPanel from './LibraryPanel'
import SavesPanel from './SavesPanel'
import KitAdvisor from './KitAdvisor'
import { BomPane, InventoryPane } from './PartsList'

const TITLE: Record<DockPane, string> = {
  file: 'btn.file',
  library: 'lib.title',
  saves: 'saves.title',
  advisor: 'btn.advisor',
  bom: 'side.bom',
  inventory: 'side.inventory',
}

export default function RightDock() {
  const { pane } = useDock()
  const { t } = useI18n()
  const { right } = usePanelLayout()
  if (!pane) return null

  return (
    <aside
      className="fixed z-30 overflow-hidden flex flex-col bg-gray-950/85 backdrop-blur border border-gray-800 rounded-2xl shadow-xl text-gray-200"
      style={panelStyle('right', right)}
    >
      <PanelHandles side="right" moveLabel={t('hint.movePanel')} sizeLabel={t('hint.resize')} />
      <div className="px-3 py-2 border-b border-gray-800 text-sm font-semibold shrink-0">{t(TITLE[pane])}</div>
      {pane === 'file' && <FilePanel />}
      {pane === 'library' && <LibraryPanel />}
      {pane === 'saves' && <SavesPanel />}
      {pane === 'advisor' && <KitAdvisor />}
      {pane === 'bom' && <BomPane />}
      {pane === 'inventory' && <InventoryPane />}
    </aside>
  )
}
