// ?doc=<doc id>：打开自己「我的设计」里的这一座（站点工作台「我的设计」点卡片时用）。
// 已有本机存档也核对服务端最新内容；单文档读取不代表完整拉取进度。
import { docs, storage } from '../engine-api'
import type { RemoteDoc } from './types'

/** 服务端列表里的这一座，删掉的不算 */
export function pickRemote(items: RemoteDoc[], id: string): RemoteDoc | null {
  return items.find(d => d.id === id && !d.deletedAt && d.data != null) || null
}

/** 本机有没有这一座（删掉还没同步的墓碑不算） */
export async function hasLocalDoc(id: string): Promise<boolean> {
  return !!(await docs.getDoc(id))
}

/** 单文档核对最新服务端内容；不改变完整拉取的检查点。 */
export async function pullDoc(baseUrl: string, id: string): Promise<boolean> {
  const epoch = storage.getAccountEpoch()
  const scope = storage.getAccountScope()
  if (!scope.startsWith('user:')) throw new Error('verified account required')
  const userId = scope.slice(5)
  const res = await fetch(`${baseUrl}/models/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', 'X-Builder-User-ID': userId } })
  if (epoch !== storage.getAccountEpoch() || res.headers.get('X-Builder-User-ID') !== userId) throw new Error('account changed')
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`GET /models/${id} → ${res.status}`)
  const doc = await res.json() as RemoteDoc
  if (epoch !== storage.getAccountEpoch()) throw new Error('account changed')
  if (doc.id !== id || !Number.isSafeInteger(doc.rev)) throw new Error('invalid remote model')
  await docs.putRemoteDoc(doc)
  return !doc.deletedAt && doc.data !== null && doc.data !== undefined
}
