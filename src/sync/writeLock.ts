/** 同源页面按账号排队写模型；不支持 Web Locks 的浏览器仍由服务端版本和回执保护。 */
export async function withAccountWriteLock<T>(account: string, write: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!navigator.locks) return write()
  return navigator.locks.request(`quadro:model-write:${account}`, { mode: 'exclusive', ...(signal ? { signal } : {}) }, write)
}
