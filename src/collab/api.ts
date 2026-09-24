// 共享方案的服务端接口（quadro 的 /collab，经网关在 VITE_SYNC_BASE 下面）。
// 接口的定义见主仓库 design/接口约定-设计师与共享方案.md。出错就抛出，
// 带上服务端给的说明，界面照原样提示。

import type { ModelJSON } from './ymodel'

export type Role = 'owner' | 'editor' | 'commenter' | 'guest'

export interface Member {
  userId: number
  name: string
  avatar: string
  role: Exclude<Role, 'guest'>
  canDeliver: boolean
}

export interface Me {
  userId: number
  name: string
  avatar: string
}

export interface Plan {
  id: string
  name: string
  data: ModelJSON | null
  qdf: string
  members: Member[]
  myRole: Role
  me: Me | null
  briefId: number | null
}

export interface VersionInfo {
  id: number
  name: string
  createdBy: number
  createdAt: number
}

export interface Version extends VersionInfo {
  state: string
  data: ModelJSON
  qdf: string
}

export interface Anchor {
  partId: string | null
  point: [number, number, number]
}

export interface Ref {
  kind: 'thread' | 'version' | 'fork'
  id: string | number
}

export interface Post {
  id: number
  userId: number
  name: string
  avatar: string
  body: string
  photos: string[]
  refs: Ref[]
  createdAt: number
}

export interface Thread {
  id: number
  kind: 'pin' | 'chat'
  anchor: Anchor | null
  versionId: number | null
  resolved: boolean
  posts: Post[]
}

export type Parts = Record<string, Record<string, number>>

export interface Metrics {
  maxDeckHeight: number
  maxSpan: number
  hasGuard: boolean
  footprint: number
}

export interface ExportBody {
  name: string
  data: ModelJSON
  qdf: string
  parts: Parts
}

export interface Room {
  w: number
  d: number
  h: number
  outline?: Array<[number, number]>
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function apiBase(): string {
  const base = import.meta.env.VITE_SYNC_BASE
  if (!base) throw new Error('VITE_SYNC_BASE is not set')
  return base
}

export function collabEnabled(): boolean {
  return Boolean(import.meta.env.VITE_SYNC_BASE)
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include', headers: { Accept: 'application/json' } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
  }
  const res = await fetch(`${apiBase()}${path}`, init)
  const text = await res.text()
  const json = text ? JSON.parse(text) as Record<string, unknown> : {}
  if (!res.ok) throw new ApiError(res.status, String(json.error || `${method} ${path} → ${res.status}`), String(json.code || ''))
  return json as T
}

const enc = encodeURIComponent

export const collabApi = {
  plan: (id: string) => call<Plan>('GET', `/collab/plans/${enc(id)}`),
  createPlan: (body: { id: string; name: string } & Omit<ExportBody, 'name'>) =>
    call<Plan>('POST', '/collab/plans', body),
  mine: () => call<Array<{ id: string; name: string; role: Role; briefId: number | null; unread: number; updatedAt: number }>>('GET', '/collab/plans/mine'),
  exportPlan: (id: string, body: ExportBody) => call<unknown>('PUT', `/collab/plans/${enc(id)}/export`, body),
  invite: (id: string) => call<{ token: string; url: string }>('POST', `/collab/plans/${enc(id)}/invites`),
  join: (token: string) => call<{ planId: string }>('POST', `/collab/invites/${enc(token)}/join`),
  setRole: (id: string, userId: number, role: Role) => call<unknown>('PUT', `/collab/plans/${enc(id)}/members/${userId}`, { role }),
  removeMember: (id: string, userId: number) => call<unknown>('DELETE', `/collab/plans/${enc(id)}/members/${userId}`),
  versions: (id: string) => call<VersionInfo[]>('GET', `/collab/plans/${enc(id)}/versions`),
  saveVersion: (id: string, body: { name: string; state: string } & Omit<ExportBody, 'name'>) =>
    call<VersionInfo>('POST', `/collab/plans/${enc(id)}/versions`, body),
  version: (id: string, vid: string | number) => call<Version>('GET', `/collab/plans/${enc(id)}/versions/${enc(String(vid))}`),
  threads: (id: string) => call<Thread[]>('GET', `/collab/plans/${enc(id)}/threads`),
  newThread: (id: string, body: { anchor: Anchor; versionId: number | null; body: string; photos: string[]; refs: Ref[] }) =>
    call<Thread>('POST', `/collab/plans/${enc(id)}/threads`, body),
  reply: (tid: number, body: { body: string; photos: string[]; refs: Ref[] }) =>
    call<Post>('POST', `/collab/threads/${tid}/posts`, body),
  resolve: (tid: number) => call<unknown>('POST', `/collab/threads/${tid}/resolve`),
  reopen: (tid: number) => call<unknown>('POST', `/collab/threads/${tid}/reopen`),
  photo: (id: string, file: File) => {
    const form = new FormData()
    form.append('photo', file)
    return call<{ path: string }>('POST', `/collab/plans/${enc(id)}/photos`, form)
  },
  read: (id: string) => call<unknown>('POST', `/collab/plans/${enc(id)}/read`),
  fork: (id: string, versionId: number | null) => call<{ planId: string }>('POST', `/collab/plans/${enc(id)}/fork`, { versionId }),
  deliver: (id: string, body: { versionId: number; ageNote: string; loadNote: string; metrics: Metrics }) =>
    call<{ token: string }>('POST', `/collab/plans/${enc(id)}/deliver`, body),
  delivery: (token: string) => call<{ data: ModelJSON; qdf: string; supersededBy: string | null } & Record<string, unknown>>('GET', `/collab/deliveries/${enc(token)}`),
  brief: (id: string) => call<{ id: number; room: Room | null } & Record<string, unknown>>('GET', `/briefs/${enc(id)}`),
  saveRoom: (id: string, room: Room) => call<unknown>('PUT', `/briefs/${enc(id)}/room`, { room }),
}

/** WebSocket 地址：同一个站点下的 {VITE_SYNC_BASE}/collab，y-websocket 在后面拼 /ws?plan=。 */
export function wsServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${apiBase()}/collab`
}

/**
 * 评论图片、头像这些服务端给的路径变成能打开的地址：完整地址和 / 开头的原样用，
 * covers 目录下的相对路径（plans/<id>/...）挂在 {VITE_SYNC_BASE}/covers/ 下面，和封面一样。
 */
export function mediaUrl(path: string): string {
  if (!path) return ''
  if (/^(https?:|\/|data:)/.test(path)) return path
  return `${apiBase()}/covers/${path.replace(/\\/g, '/')}`
}
