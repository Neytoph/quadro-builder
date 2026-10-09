import { HELLO, READY, type AssetBoot } from './protocol'

declare const __PUBLIC_ASSET_BOOT__: AssetBoot

/** 与界面的语言优先级一致；引导器不引入React或整份字典，存储被禁用时仍能加载。 */
export function bootLanguage(search: string, getItem: (key: string) => string | null, browserLanguage: string): 'zh' | 'en' | 'de' {
  const valid = (value: string | null): value is 'zh' | 'en' | 'de' => value === 'zh' || value === 'en' || value === 'de'
  const fromUrl = new URLSearchParams(search).get('lang')
  if (valid(fromUrl)) return fromUrl
  try {
    const stored = getItem('quadro-builder-lang') || getItem('quadro.lang')
    if (valid(stored)) return stored
  } catch { /* 语言偏好存储不可读时按浏览器语言，不能阻止canonical入口。 */ }
  const nav = (browserLanguage || '').toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  if (nav.startsWith('de')) return 'de'
  return 'en'
}

/** 有界等待当前控制器的准确版本；迟到claim不会重启已经加载的应用。 */
export function waitForAssetController(serviceWorker: ServiceWorkerContainer | undefined, config: AssetBoot): Promise<boolean> {
  if (!serviceWorker) return Promise.resolve(false)
  return new Promise(resolve => {
    let done = false
    const ports = new Set<MessagePort>()
    const finish = (ready: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      serviceWorker.removeEventListener('controllerchange', hello)
      for (const port of ports) port.close()
      resolve(ready)
    }
    const hello = () => {
      const controller = serviceWorker.controller
      if (done || !controller) return
      const channel = new MessageChannel()
      ports.add(channel.port1)
      channel.port1.onmessage = event => {
        const data = event.data as { type?: unknown; protocol?: unknown; release?: unknown; mode?: unknown } | null
        if (serviceWorker.controller === controller && data?.type === READY && data.protocol === 1
          && data.release === config.release && data.mode === config.mode) finish(true)
      }
      try { controller.postMessage({ type: HELLO, protocol: 1, release: config.release }, [channel.port2]) }
      catch { channel.port1.close(); ports.delete(channel.port1) }
    }
    const timer = setTimeout(() => finish(false), config.controllerBudgetMs)
    serviceWorker.addEventListener('controllerchange', hello)
    hello()
    try {
      void serviceWorker.register(`${config.base}public-assets-sw.js`, { scope: config.base, updateViaCache: 'none' })
        .then(() => hello(), () => finish(false))
    } catch { finish(false) }
  })
}

export async function bootPublicAssets(config: AssetBoot, page: Window = window): Promise<void> {
  const state = page as Window & { __xmfPublicAssetsBoot?: boolean }
  if (state.__xmfPublicAssetsBoot) return
  state.__xmfPublicAssetsBoot = true
  const doc = page.document
  const language = bootLanguage(page.location.search, key => page.localStorage.getItem(key), page.navigator.language)
  const errorText = { zh: '设计器加载失败。请刷新页面重试。', en: 'The designer could not load. Refresh the page to retry.',
    de: 'Der Designer konnte nicht geladen werden. Bitte die Seite zum erneuten Versuch aktualisieren.' }
  const retryText = { zh: '刷新重试', en: 'Refresh and retry', de: 'Aktualisieren und erneut versuchen' }
  const failed = (error: unknown) => {
    console.error('[public assets boot]', error)
    const status = doc.createElement('p')
    status.setAttribute('role', 'alert')
    status.textContent = errorText[language]
    // 此时应用CSS本身可能下载失败，错误入口须独立可读。
    status.style.cssText = 'margin:24px;padding:24px;background:#fff;color:#1f2430;font:16px/1.5 system-ui;border-radius:12px'
    const retry = doc.createElement('button')
    retry.type = 'button'
    retry.textContent = retryText[language]
    retry.style.cssText = 'display:block;margin-top:16px;padding:8px 16px'
    // 仅用户明确点击后重新打开同一文档；永远不向已可能执行的入口再注入第二份模块。
    retry.onclick = () => page.location.reload()
    status.append(retry)
    doc.getElementById('root')?.replaceChildren(status)
  }
  try {
    let serviceWorker: ServiceWorkerContainer | undefined
    try { serviceWorker = page.navigator.serviceWorker }
    catch (error) { console.warn('[public assets controller unavailable]', error) }
    await waitForAssetController(serviceWorker, config)
    // modulepreload只下载/编译，不执行；与CSS并行，后续同URL模块脚本复用浏览器module map。
    const preload = doc.createElement('link')
    preload.rel = 'modulepreload'
    preload.href = config.entry
    const codeReady = preload.relList.supports('modulepreload') ? new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { preload.remove(); reject(new Error('public application preload timed out')) }, 65000)
      preload.onload = () => { clearTimeout(timer); resolve() }
      preload.onerror = () => { clearTimeout(timer); reject(new Error('public application preload failed')) }
      doc.head.append(preload)
    }) : Promise.resolve()
    const stylesReady = config.styles.map(url => new Promise<void>((resolve, reject) => {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      const timer = setTimeout(() => { link.remove(); reject(new Error('public stylesheet timed out')) }, 65000)
      link.onload = () => { clearTimeout(timer); resolve() }
      link.onerror = () => { clearTimeout(timer); reject(new Error('public stylesheet failed')) }
      doc.head.append(link)
    }))
    await Promise.all([codeReady, ...stylesReady])
    const script = doc.createElement('script')
    script.type = 'module'
    script.src = config.entry
    script.setAttribute('fetchpriority', 'high')
    const timer = setTimeout(() => failed(new Error('public application entry timed out')), 65000)
    script.onload = () => clearTimeout(timer)
    script.onerror = () => { clearTimeout(timer); failed(new Error('public application entry failed')) }
    doc.head.append(script)
  } catch (error) { failed(error) }
}

if (typeof __PUBLIC_ASSET_BOOT__ !== 'undefined') void bootPublicAssets(__PUBLIC_ASSET_BOOT__)
