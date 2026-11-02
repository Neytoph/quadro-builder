/** 超时包含响应正文读取；退出账号时立即释放正在等待的写入。 */
export async function withRequestDeadline<T>(source: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  source?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(source?.reason)
  source?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Model request timed out', 'TimeoutError')), 15_000)
  try { return await operation(controller.signal) }
  finally { clearTimeout(timer); source?.removeEventListener('abort', abort) }
}
