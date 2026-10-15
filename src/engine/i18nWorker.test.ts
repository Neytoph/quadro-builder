import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('Worker全局契约夹具：无localStorage仍能导入真实翻译并切换三语', async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', undefined)
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  const { getLang, setLang, t } = await import('./i18n.js')
  expect(getLang()).toBe('zh')
  expect(typeof t('tube')).toBe('string')
  setLang('de'); expect(getLang()).toBe('de')
  setLang('en'); expect(getLang()).toBe('en')
})
