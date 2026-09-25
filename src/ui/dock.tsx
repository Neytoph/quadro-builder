import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePanelLayout } from './panelLayout'
import { LIBRARY_OPEN_EVENT } from './LibraryPanel'

export type DockPane = 'file' | 'library' | 'saves' | 'advisor' | 'bom' | 'inventory' | 'safety'
  | 'comments' | 'versions'

export const LIB_DOCK_MIN = 360
/** 评论和版本抽屉：设计稿定的 372 宽 */
export const COMMENTS_DOCK_MIN = 372

export const DOCK_PILLS: { id: DockPane; labelKey: string }[] = [
  { id: 'file', labelKey: 'btn.file' },
  { id: 'library', labelKey: 'btn.library' },
  { id: 'saves', labelKey: 'btn.saves' },
  { id: 'advisor', labelKey: 'btn.advisor' },
  { id: 'bom', labelKey: 'side.bom' },
  { id: 'inventory', labelKey: 'side.inventory' },
  { id: 'safety', labelKey: 'btn.safety' },
]

/** 共享方案里多出来的两个抽屉 */
export const PLAN_PILLS: { id: DockPane; labelKey: string }[] = [
  { id: 'comments', labelKey: 'collab.pane.comments' },
  { id: 'versions', labelKey: 'collab.pane.versions' },
]

type Ctx = {
  pane: DockPane | null
  setPane: (p: DockPane | null) => void
  toggle: (p: DockPane) => void
  handleEsc: () => void
  /** 评论抽屉要停在哪一栏：共享方案的提示气泡替人切到「留言」 */
  commentsTab: CommentsTab | null
  setCommentsTab: (tab: CommentsTab | null) => void
}

export type CommentsTab = 'pins' | 'chat'

const DockCtx = createContext<Ctx | null>(null)

export function DockProvider({ children }: { children: ReactNode }) {
  const [pane, setPane] = useState<DockPane | null>(null)
  const [commentsTab, setCommentsTab] = useState<CommentsTab | null>(null)
  const { right, patchRight } = usePanelLayout()

  useEffect(() => {
    if (pane === 'library' && right.width < LIB_DOCK_MIN) patchRight({ width: LIB_DOCK_MIN })
    if ((pane === 'comments' || pane === 'versions') && right.width < COMMENTS_DOCK_MIN) patchRight({ width: COMMENTS_DOCK_MIN })
  }, [pane, right.width, patchRight])

  useEffect(() => {
    const openLib = () => setPane('library')
    window.addEventListener(LIBRARY_OPEN_EVENT, openLib)
    return () => window.removeEventListener(LIBRARY_OPEN_EVENT, openLib)
  }, [])

  const toggle = useCallback((p: DockPane) => {
    setPane(cur => cur === p ? null : p)
  }, [])

  const handleEsc = useCallback(() => {
    setPane(null)
  }, [])

  const value = useMemo(() => ({ pane, setPane, toggle, handleEsc, commentsTab, setCommentsTab }), [pane, toggle, handleEsc, commentsTab])
  return <DockCtx.Provider value={value}>{children}</DockCtx.Provider>
}

export function useDock() {
  const ctx = useContext(DockCtx)
  if (!ctx) throw new Error('useDock')
  return ctx
}
