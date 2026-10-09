import { afterEach, describe, expect, it } from 'vitest'
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads'
import { bootLanguage, waitForAssetController } from './boot'
import { READY, type AssetBoot } from './protocol'

const config: AssetBoot = { protocol: 1, release: 'a'.repeat(64), mode: 'public-ipv6-fallback', base: '/builder/',
  entry: '/builder/assets/index-abcdefgh.js', styles: ['/builder/assets/index-abcdefgh.css'], controllerBudgetMs: 25 }
const originalChannel = globalThis.MessageChannel
afterEach(() => { globalThis.MessageChannel = originalChannel })

function container(readyRelease: string, throws = false) {
  globalThis.MessageChannel = NodeMessageChannel as unknown as typeof MessageChannel
  const target = new EventTarget()
  const registrations: unknown[] = []
  const controller = { postMessage(_data: unknown, ports: MessagePort[]) {
    ports[0].postMessage({ type: READY, protocol: 1, release: readyRelease, mode: config.mode })
    ports[0].close()
  } }
  return Object.assign(target, { controller, registrations, register(...options: unknown[]) {
    registrations.push(options)
    if (throws) throw new DOMException('blocked', 'SecurityError')
    return Promise.resolve({})
  } }) as unknown as ServiceWorkerContainer & { registrations: unknown[] }
}

describe('bounded exact controller handshake', () => {
  it('failure messages follow URL language, saved preference and normalized browser language without requiring storage', () => {
    expect(bootLanguage('?lang=de', () => { throw new Error('URL must win') }, 'zh-CN')).toBe('de')
    expect(bootLanguage('', key => key === 'quadro-builder-lang' ? 'en' : 'de', 'zh-CN')).toBe('en')
    expect(bootLanguage('', key => key === 'quadro.lang' ? 'de' : null, 'zh-CN')).toBe('de')
    expect(bootLanguage('?lang=invalid', () => { throw new DOMException('blocked', 'SecurityError') }, 'DE-de')).toBe('de')
    expect(bootLanguage('', () => null, 'ZH-cn')).toBe('zh')
    expect(bootLanguage('', () => null, 'fr-FR')).toBe('en')
  })

  it('accepts only the correct release and registers only the fixed same-origin URL and scope', async () => {
    const sw = container(config.release)
    expect(await waitForAssetController(sw, config)).toBe(true)
    expect(sw.registrations).toEqual([['/builder/public-assets-sw.js', { scope: '/builder/', updateViaCache: 'none' }]])
  })

  it('an old controller cannot claim readiness for a newer page; a late claim cannot resume the resolved wait', async () => {
    const sw = container('old-release')
    expect(await waitForAssetController(sw, config)).toBe(false)
    const before = sw.registrations.length
    sw.dispatchEvent(new Event('controllerchange'))
    expect(sw.registrations.length).toBe(before)
  })

  it('unavailable or synchronously blocked registration degrades to canonical instead of rejecting boot', async () => {
    expect(await waitForAssetController(undefined, config)).toBe(false)
    expect(await waitForAssetController(container('old', true), config)).toBe(false)
  })
})
