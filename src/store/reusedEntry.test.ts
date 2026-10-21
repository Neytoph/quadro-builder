import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })
describe('复用编辑器重新选择文档', () => {
  async function embedded() {
    vi.resetModules()
    vi.stubEnv('VITE_SYNC_BASE', '/quadro')
    vi.stubGlobal('parent', {})
    location.href = 'http://localhost:3000/builder/?embedded=model&editorOwner=7&src=/quadro/library/aa/native'
    return import('../entry')
  }
  it('来源和草稿键同时切换，保持账号及嵌入限制', async () => {
    const entry = await embedded()
    expect(entry.EDITOR_EMBED).toBe(true)
    const oldSession = entry.EDITOR_SESSION
    entry.replaceEditorEntry('/builder/?embedded=model&editorOwner=7&src=/quadro/library/bb/native&name=第二座&lang=de')
    expect(entry.bootEntry().src).toBe('/quadro/library/bb/native')
    expect(entry.bootEntry().name).toBe('第二座')
    expect(entry.bootEntry().lang).toBe('de')
    expect(entry.EDITOR_SESSION).not.toBe(oldSession)
    expect(entry.EDITOR_SESSION).toContain('/quadro/library/bb/native')
  })
  it('拒绝跨账号、跨站、提权入口和混合来源，失败保持原文档', async () => {
    const entry = await embedded(), original = location.href
    for (const href of [
      '/builder/?embedded=model&editorOwner=8&src=/quadro/library/bb/native',
      'https://other.test/builder/?embedded=model&editorOwner=7&src=/quadro/library/bb/native',
      '/builder/?embedded=model&editorOwner=7&src=/admin/people/7/model',
      '/builder/?embedded=model&editorOwner=7&src=/quadro/library/bb/native&plan=p1',
      '/builder/?embedded=model&editorOwner=7&src=/quadro/library/bb/native&copy=1',
      '/builder/?embedded=model&editorOwner=7&src=/quadro/library/bb/native&view=1',
    ]) expect(() => entry.replaceEditorEntry(href)).toThrow()
    expect(location.href).toBe(original)
    expect(entry.bootEntry().src).toBe('/quadro/library/aa/native')
  })
})
