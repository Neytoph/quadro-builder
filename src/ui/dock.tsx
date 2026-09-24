import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePanelLayout } from './panelLayout'
import { LIBRARY_OPEN_EVENT } from './LibraryPanel'

export type DockPane = 'file' | 'library' | 'saves' | 'advisor' | 'bom' | 'inventory' | 'safety'
  | 'comments' | 'versions' | 'members'

export const LIB_DOCK_MIN = 360
/** 评论侧栏要放讨论和输入框，窄了挤 */
export const COMMENTS_DOCK_MIN = 340

export const DOCK_PILLS: { id: DockPane; labelKey: string }[] = [
  { id: 'file', labelKey: 'btn.file' },
  { id: 'library', labelKey: 'btn.library' },
  { id: 'saves', labelKey: 'btn.saves' },
  { id: 'advisor', labelKey: 'btn.advisor' },
  { id: 'bom', labelKey: 'side.bom' },
  { id: 'inventory', labelKey: 'side.inventory' },
  { id: 'safety', labelKey: 'btn.safety' },
]

/** 共享方案里多出来的三个面板 */
export const PLAN_PILLS: { id: DockPane; labelKey: string }[] = [
  { id: 'comments', labelKey: 'collab.pane.comments' },
  { id: 'versions', labelKey: 'collab.pane.versions' },
  { id: 'members', labelKey: 'collab.pane.members' },
]

type Ctx = {
  pane: DockPane | null
  setPane: (p: DockPane | null) => void
  toggle: (p: DockPane) => void
  handleEsc: () => void
}

const DockCtx = createContext<Ctx | null>(null)

export function DockProvider({ children }: { children: ReactNode }) {
  const [pane, setPane] = useState<DockPane | null>(null)
  const { right, patchRight } = usePanelLayout()

  useEffect(() => {
    if (pane === 'library' && right.width < LIB_DOCK_MIN) patchRight({ width: LIB_DOCK_MIN })
    if (pane === 'comments' && right.width < COMMENTS_DOCK_MIN) patchRight({ width: COMMENTS_DOCK_MIN })
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

  const value = useMemo(() => ({ pane, setPane, toggle, handleEsc }), [pane, toggle, handleEsc])
  return <DockCtx.Provider value={value}>{children}</DockCtx.Provider>
}

export function useDock() {
  const ctx = useContext(DockCtx)
  if (!ctx) throw new Error('useDock')
  return ctx
}
