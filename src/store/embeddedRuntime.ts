import { EDITOR_EMBED, replaceEditorEntry } from '../entry'
import { getAccountScope } from '../engine/storage.js'
import { editorScenes } from './scenePool'

/** 文档组件卸载后只保留程序模块和单个暂停场景。 */
export function installEmbeddedRuntime(mount: () => void, unmount: () => void) {
  if (!EDITOR_EMBED) return
  const owner = new URLSearchParams(location.search).get('editorOwner')
  let parked = false, canPark = false, busy = false
  window.addEventListener('xmf-editor:can-park', () => { canPark = true })
  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.source !== parent || busy) return
    const { type, requestId, url } = event.data || {}
    if (!['xmf-model-editor:park', 'xmf-model-editor:resume'].includes(type) || typeof requestId !== 'string') return
    const send = (name: string, extra = {}) => parent.postMessage({ type: `xmf-model-editor:${name}`, requestId, ...extra }, location.origin)
    busy = true
    try {
      if (type === 'xmf-model-editor:park') {
        if (!canPark || parked || !owner || String(getAccountScope()) !== `user:${owner}`) { send('park-rejected'); return }
        unmount()
        delete document.documentElement.dataset.editorReady
        parked = true
        canPark = false
        send('parked')
      } else {
        if (!parked || typeof url !== 'string' || !owner || String(getAccountScope()) !== `user:${owner}`) throw new Error('Editor account changed')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        try {
          const response = await fetch('/whoami', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
          if (!response.ok) throw new Error('Editor identity HTTP ' + response.status)
          const identity = await response.json()
          if (!identity.authenticated || String(identity.user_id) !== owner || String(getAccountScope()) !== `user:${owner}`) throw new Error('Editor account changed')
        } finally { clearTimeout(timer) }
        replaceEditorEntry(url)
        parked = false
        mount()
      }
    } catch (error) {
      editorScenes.clear()
      send('error', { message: error instanceof Error ? error.message : String(error) })
    } finally { busy = false }
  })
}
