// 一座造型的编辑记录：把引擎的每一次编辑写进 Yjs 文档，撤销和重做交给 Y.UndoManager。
//
// 引擎的 Builder 在每一次编辑的收尾（recordHistory / _pushHistory）调 commit(前, 后)。
// 这两份 JSON 的差异按零件写进文档，事务的 origin 是这里独有的一个对象：UndoManager
// 只记这个 origin 的事务，撤销时只撤自己的修改，别人（另一个浏览器、另一个成员）
// 的修改不受影响。
//
// 文档的其他变化（撤销和重做、别人的修改、本机数据库读出来的内容）都经 onExternal
// 通知出去，由 Builder 从文档重新读出整座造型、刷新画面。

import * as Y from 'yjs'
import { applyDelta, docToJSON, flatten, metaMap, partsMap, restoreParts, summarize, type EditSummary, type ModelJSON, type Rec } from './ymodel'

/** 撤销步数上限，和原来的撤销栈一样。 */
const MAX_UNDO = 60

/** 撤销以后把还有零件连着的零件补回来：这个事务不进撤销记录。 */
const REPAIR_ORIGIN = { name: 'undo-repair' }

/**
 * 一件零件离不开哪些零件：管的两端接头、板和布的两根承重管、套在管上的接头、
 * 挂在管上的配件。组只是一批 id，不算。
 */
function refsOf(get: (k: string) => unknown): string[] {
  const out: string[] = []
  const add = (v: unknown) => { if (typeof v === 'string' && v) out.push(v) }
  switch (get('$type')) {
    case 'tube':
    case 'panel':
    case 'textile':
      add(get('a'))
      add(get('b'))
      break
    case 'node':
      add((get('clampOn') as { tubeId?: string } | undefined)?.tubeId)
      add(get('bearingOn'))
      break
    case 'fitting':
      add(get('tube'))
      break
  }
  return out
}

export class ModelHistory {
  readonly doc: Y.Doc
  readonly origin = { name: 'local-edit' }
  private readonly manager: Y.UndoManager
  private external: () => void = () => {}
  private changed: () => void = () => {}
  private edited: (s: EditSummary) => void = () => {}
  private readonly onTx: (tr: Y.Transaction) => void
  private readonly onStack: () => void

  constructor(doc: Y.Doc) {
    this.doc = doc
    this.manager = new Y.UndoManager([partsMap(doc), metaMap(doc)], {
      trackedOrigins: new Set([this.origin]),
      // 每次提交本来就是用户的一步，不按时间合并
      captureTimeout: 0,
    })
    this.onStack = () => {
      while (this.manager.undoStack.length > MAX_UNDO) this.manager.undoStack.shift()
      this.changed()
    }
    this.manager.on('stack-item-added', this.onStack)
    this.manager.on('stack-item-popped', this.onStack)
    this.onTx = (tr) => {
      if (tr.origin === this.origin) return
      if (!tr.changed.size) return
      this.external()
    }
    doc.on('afterTransaction', this.onTx)
  }

  /** 文档被别处改了（撤销、重做、别人、本机数据库）。 */
  onExternal(cb: () => void) { this.external = cb }

  /** 撤销和重做能不能用变了。 */
  onChange(cb: () => void) { this.changed = cb }

  /** 自己改了一次（编辑、撤销、重做），共享方案靠它告诉别人「谁加了几件」。 */
  onEdit(cb: (s: EditSummary) => void) { this.edited = cb }

  /** 一次编辑：编辑前、编辑后的两份 JSON 文本。 */
  commit(before: string, after: string) {
    if (before === after) return
    const summary = applyDelta(this.doc, JSON.parse(before) as ModelJSON, JSON.parse(after) as ModelJSON, this.origin)
    this.edited(summary)
  }

  toJSON(): ModelJSON {
    return docToJSON(this.doc)
  }

  // 撤掉自己加的零件时，别人的零件可能还连在它上面（接在我加的接头上的管、挂在我加的
  // 管上的板）。撤完以后把这些还被连着的零件按撤销前的样子补回来，别人的零件不会悬空。
  undo() { this.withRepair(() => this.manager.undo()) }
  redo() { this.withRepair(() => this.manager.redo()) }

  private withRepair(step: () => void) {
    const before = flatten(docToJSON(this.doc))
    step()
    this.repair(before)
    this.edited(summarize(before, flatten(docToJSON(this.doc))))
  }

  private repair(before: Map<string, Rec>) {
    const parts = partsMap(this.doc)
    const restore = new Map<string, Rec>()
    let grew = true
    while (grew) {
      grew = false
      const needs: string[] = []
      for (const part of parts.values()) needs.push(...refsOf(k => part.get(k)))
      for (const rec of restore.values()) needs.push(...refsOf(k => rec[k]))
      for (const id of needs) {
        if (parts.has(id) || restore.has(id)) continue
        const rec = before.get(id)
        if (!rec) continue
        restore.set(id, rec)
        grew = true
      }
    }
    if (restore.size) restoreParts(this.doc, restore, REPAIR_ORIGIN)
  }
  canUndo() { return this.manager.canUndo() }
  canRedo() { return this.manager.canRedo() }

  clear() {
    this.manager.clear()
    this.changed()
  }

  destroy() {
    this.doc.off('afterTransaction', this.onTx)
    this.manager.off('stack-item-added', this.onStack)
    this.manager.off('stack-item-popped', this.onStack)
    this.manager.destroy()
  }
}
