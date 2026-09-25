// ?doc=<doc id>：打开自己「我的设计」里的这一座（站点工作台「我的设计」点卡片时用）。
// 同步跑完一轮以后本机一般就有了；本机还是没有（这台设备上登过别的账号，拉取游标跑到了前面），
// 就把服务端的整份列表拉一遍取这一座。服务端只给自己的，别人的、删掉的都拿不到。
import { docs } from '../engine-api'
import type { PullResponse, RemoteDoc } from './types'

/** 服务端列表里的这一座，删掉的不算 */
export function pickRemote(items: RemoteDoc[], id: string): RemoteDoc | null {
  return items.find(d => d.id === id && !d.deletedAt && d.data != null) || null
}

/** 本机有没有这一座（删掉还没同步的墓碑不算） */
export async function hasLocalDoc(id: string): Promise<boolean> {
  return !!(await docs.getDoc(id))
}

/** 本机没有就从 /models 拉下来放进本机。拉到了（或者本来就有）返回 true，服务端也没有返回 false */
export async function pullDoc(baseUrl: string, id: string): Promise<boolean> {
  if (await hasLocalDoc(id)) return true
  const res = await fetch(`${baseUrl}/models?since=0`, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET /models → ${res.status}`)
  const doc = pickRemote(((await res.json()) as PullResponse).items, id)
  if (!doc) return false
  await docs.putRemoteDoc(doc)
  return true
}
