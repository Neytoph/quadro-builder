/** 读取也包含响应正文；断线或瞬时网关错误只重试一次，不重试权限和格式错误。 */
export async function readModelSource(url: string, init: RequestInit = {}): Promise<{ response: Response; text: string }> {
  if (init.method && init.method.toUpperCase() !== 'GET') throw new TypeError('Model source requires GET')
  init.signal?.throwIfAborted()
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const abort = () => controller.abort(init.signal?.reason)
    if (init.signal?.aborted) abort()
    else init.signal?.addEventListener('abort', abort, { once: true })
    const timer = window.setTimeout(() => controller.abort(new DOMException('Model source read timed out', 'TimeoutError')), 15000)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (attempt === 0 && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel()
        continue
      }
      return { response, text: response.ok ? await response.text() : '' }
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error
      if (init.signal?.aborted || attempt > 0 || !(error instanceof TypeError || controller.signal.aborted)) throw failure
      console.warn('[model source] retrying interrupted read', failure)
    } finally {
      window.clearTimeout(timer)
      init.signal?.removeEventListener('abort', abort)
    }
  }
}
