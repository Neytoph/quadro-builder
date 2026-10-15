/** 每次切换方案产生独立世代；同一列表只接受最新请求。 */
export class ScopedRequests {
  current: { id: string | null; epoch: number } = { id: null, epoch: 0 }
  private readonly requests = new Map<string, AbortController>()
  select(id: string | null) {
    if (id !== this.current.id) {
      this.cancel()
      this.current = { id, epoch: this.current.epoch + 1 }
    }
  }
  cancel() {
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }
  async run<T>(id: string, key: string, fetchValue: (signal: AbortSignal) => Promise<T>, apply: (value: T, epoch: number) => void) {
    if (id !== this.current.id) return
    const generation = this.current
    this.requests.get(key)?.abort()
    const controller = new AbortController()
    this.requests.set(key, controller)
    try {
      const value = await fetchValue(controller.signal)
      if (controller.signal.aborted || generation !== this.current || this.requests.get(key) !== controller) return
      apply(value, generation.epoch)
    } catch (error) {
      if (!controller.signal.aborted && generation === this.current) throw error
    } finally {
      if (this.requests.get(key) === controller) this.requests.delete(key)
    }
  }
}
