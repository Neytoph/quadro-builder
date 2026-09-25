// 本机的 Yjs 文档。
//
// 每个标签页一份文档，用 y-indexeddb 存在本机，库名 `quadro.tab.<标签页 id>`：
// 标签页里还没保存的工作状态就在这里，刷新、关掉浏览器再打开都还在。
// 「保存」照旧把文档导出成 JSON 写进存档（engine/docs.js），个人造型的 /models
// 同步只认存档。关掉标签页时连库一起删掉。
//
// 共享方案的标签页也一样存在本机：断网时的修改先存在这里，连上以后由 y-websocket
// 交给服务器合并。

import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { docIsEmpty, writeJSON, type ModelJSON } from './ymodel'
import { ModelHistory } from './history'

/** 从存档、旧会话、文件、服务器 data 写进一份空文档时的 origin：不进撤销记录。 */
export const SEED_ORIGIN = { name: 'seed' }

export interface LocalDoc {
  doc: Y.Doc
  history: ModelHistory
  persistence: IndexeddbPersistence | null
}

function tabDbName(tabId: string) {
  return `quadro.tab.${tabId}`
}

/**
 * 打开标签页的文档，等本机数据库读完。本机没有这份（新标签页，或者旧版本只在会话里
 * 存了造型 JSON）时写进 seed。
 */
export async function openTabDoc(tabId: string, seed: ModelJSON | null): Promise<LocalDoc> {
  const doc = new Y.Doc()
  const persistence = new IndexeddbPersistence(tabDbName(tabId), doc)
  await persistence.whenSynced
  if (docIsEmpty(doc) && seed) writeJSON(doc, seed, SEED_ORIGIN)
  return { doc, history: new ModelHistory(doc), persistence }
}

/**
 * 新标签页：本机还没有这份，直接写进 seed，数据库在后台打开后把整份存进去。
 * 共享方案的标签页 seed 为 null：文档空着，等服务器那一份。
 */
export function createTabDoc(tabId: string, seed: ModelJSON | null): LocalDoc {
  const doc = new Y.Doc()
  if (seed) writeJSON(doc, seed, SEED_ORIGIN)
  const persistence = new IndexeddbPersistence(tabDbName(tabId), doc)
  return { doc, history: new ModelHistory(doc), persistence }
}

/** 只看模式、交付查看：嵌在别的页面里，不在这台设备上留任何东西。 */
export function memoryDoc(seed: ModelJSON): LocalDoc {
  const doc = new Y.Doc()
  writeJSON(doc, seed, SEED_ORIGIN)
  return { doc, history: new ModelHistory(doc), persistence: null }
}

/** 关掉标签页：文档和本机的库一起去掉。 */
export async function dropTabDoc(tabId: string, local: LocalDoc | null) {
  if (local) {
    local.history.destroy()
    if (local.persistence) await local.persistence.clearData()
    local.doc.destroy()
    return
  }
  await clearDocument(tabDbName(tabId))
}
