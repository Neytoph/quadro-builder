type Existing = { entrySource?: string; libraryId?: string; dirty: boolean; docId: string | null; planId?: string | null }

/** 同一入口刷新恢复原草稿；不同来源使用新文档，原草稿另行保留。 */
export function sourceEntryAction(existing: Existing | undefined, source: string, library?: string): 'restore' | 'replace' | 'new' {
  if (!existing) return 'replace'
  if (library && existing.libraryId === library) return existing.dirty ? 'restore' : 'replace'
  if (!library && existing.entrySource === source) return 'restore'
  return existing.docId || existing.libraryId || existing.planId || existing.dirty ? 'new' : 'replace'
}
