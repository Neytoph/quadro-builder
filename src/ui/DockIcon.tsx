import { Box, ChevronDown, FileText, FolderOpen, History, List, MessageSquare, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import type { DockPane } from './dock'

const ICONS: Record<DockPane, LucideIcon> = {
  file: FileText, saves: FolderOpen, library: Box, advisor: Sparkles,
  bom: List, inventory: Box, safety: ShieldCheck, comments: MessageSquare, versions: History,
}

export function DockIcon({ pane, size = 18 }: { pane: DockPane; size?: number }) {
  const Icon = ICONS[pane]
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />
}

export function DockChevron() {
  return <ChevronDown size={13} strokeWidth={1.65} className="qb-nav-chevron" aria-hidden="true" />
}
