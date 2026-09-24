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
import { applyDelta, docToJSON, metaMap, partsMap, writeJSON, type ModelJSON } from './ymodel'

/** 撤销步数上限，和原来的撤销栈一样。 */
const MAX_UNDO = 60

export class ModelHistory {
  readonly doc: Y.Doc
  readonly origin = { name: 'local-edit' }
  private readonly manager: Y.UndoManager
  private external: () => void = () => {}
  private changed: () => void = () => {}
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

  /** 一次编辑：编辑前、编辑后的两份 JSON 文本。 */
  commit(before: string, after: string) {
    if (before === after) return
    applyDelta(this.doc, JSON.parse(before) as ModelJSON, JSON.parse(after) as ModelJSON, this.origin)
  }

  /** 整座换成 json，记作一步可撤销的编辑。 */
  commitAll(json: ModelJSON) {
    writeJSON(this.doc, json, this.origin)
  }

  toJSON(): ModelJSON {
    return docToJSON(this.doc)
  }

  undo() { this.manager.undo() }
  redo() { this.manager.redo() }
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
