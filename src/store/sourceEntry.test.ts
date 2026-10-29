import { describe, expect, it } from 'vitest'
import { sourceEntryAction } from './sourceEntry'
import { librarySaveIdentity } from './librarySave'

describe('分享与草稿归属', () => {
  it('其他分享进入已有个人存档时使用新文档', () => {
    expect(sourceEntryAction({ docId: 'old', dirty: false }, '/quadro/shares/new/model')).toBe('new')
    expect(sourceEntryAction({ docId: null, libraryId: 'old-object', dirty: true }, '/quadro/shares/new/model')).toBe('new')
  })
  it('同一来源刷新保留已编辑草稿，不重新覆盖', () => {
    const source = '/quadro/shares/QY113/model'
    expect(sourceEntryAction({ docId: 'saved', dirty: true, entrySource: source }, source)).toBe('restore')
    expect(sourceEntryAction({ docId: null, dirty: true }, source)).toBe('new')
  })
  it('原生编辑只恢复同一对象的未保存内容', () => {
    expect(sourceEntryAction({ docId: null, libraryId: 'a', dirty: true }, '/native', 'a')).toBe('restore')
    expect(sourceEntryAction({ docId: null, libraryId: 'b', dirty: true }, '/native', 'a')).toBe('new')
    expect(sourceEntryAction({ docId: null, libraryId: 'a', dirty: false }, '/native', 'a')).toBe('replace')
  })
  it('重试沿用保存身份，模型或名称变动取得新身份', async () => {
    const first = await librarySaveIdentity('QY113', { format: 2, nodes: [], tubes: [] })
    expect(await librarySaveIdentity('QY113', { tubes: [], nodes: [], format: 2 }, first)).toEqual(first)
    expect((await librarySaveIdentity('renamed', { format: 2, nodes: [], tubes: [] }, first)).saveId).not.toBe(first.saveId)
    expect((await librarySaveIdentity('QY113', { format: 2, nodes: [], tubes: [], panels: [] }, first)).saveId).not.toBe(first.saveId)
  })
})
