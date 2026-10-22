import type { SceneManager } from '../engine-api'

type ReusableScene = { dispose(): void; setPaused(paused: boolean): void; attachContainer(host: HTMLElement): void; canReuse?(): boolean }

/** 仅持有一个已关闭编辑器的场景；文档和协作连接不进入缓存。 */
export class ScenePool<T extends ReusableScene> {
  private cached: { owner: string; scene: T; timer: ReturnType<typeof setTimeout> } | null = null
  private readonly idleMs: number
  constructor(idleMs: number) { this.idleMs = idleMs }
  take(owner: string, host: HTMLElement): T | null {
    const cached = this.cached
    if (!cached) return null
    this.cached = null
    clearTimeout(cached.timer)
    if (cached.owner !== owner || cached.scene.canReuse?.() === false) { cached.scene.dispose(); return null }
    cached.scene.attachContainer(host)
    cached.scene.setPaused(false)
    return cached.scene
  }
  put(owner: string, scene: T) {
    this.clear()
    scene.setPaused(true)
    this.cached = { owner, scene, timer: setTimeout(() => this.clear(), this.idleMs) }
  }
  clear() {
    const cached = this.cached
    this.cached = null
    if (!cached) return
    clearTimeout(cached.timer)
    cached.scene.dispose()
  }
}

export const editorScenes = new ScenePool<InstanceType<typeof SceneManager>>(60000)
if (typeof window !== 'undefined') {
  window.addEventListener('quadro-account-invalidated', () => editorScenes.clear())
  window.addEventListener('pagehide', () => editorScenes.clear())
}
