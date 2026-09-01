// 同步层的类型。engine 侧是无类型的 JS（checkJs: false），
// 所以这里把跨边界的数据形状显式写出来，别让 any 漏进 UI。

/** 本地文档记录（engine/docs.js 的存储形状）。 */
export interface DocRecord {
  id: string
  name: string
  /** 墓碑记录的 data 为 null。 */
  data: unknown | null
  createdAt: number
  updatedAt: number
  /** 内容所出自的服务端修订号；0 表示服务端还不知道这份。 */
  rev: number
  /** 本地已改、尚未上传。 */
  dirty?: boolean
  /** 墓碑：本地已删、服务端还不知道。 */
  deletedAt?: number
}

/** 服务端下发的记录。 */
export interface RemoteDoc {
  id: string
  name: string
  data: unknown | null
  createdAt: number
  updatedAt: number
  rev: number
  deletedAt?: number | null
}

export interface PullResponse {
  /** 服务端当前最新修订号，作为下次拉取的游标。 */
  rev: number
  items: RemoteDoc[]
}

export interface PushResponse {
  rev: number
}

export type SyncEvent =
  | { type: 'start' }
  | { type: 'idle'; rev: number }
  | { type: 'pushed'; id: string; rev: number }
  | { type: 'pulled'; count: number; rev: number }
  | { type: 'conflict'; id: string; copyId: string }
  | { type: 'quota'; feature: string; used: number; limit: number }
  | { type: 'error'; error: unknown }

export interface SyncOptions {
  /** 后端前缀，例如 '/api'。不传则同步不启动（开源本地版的默认状态）。 */
  baseUrl?: string
  /** 轮询间隔（毫秒），默认 30 秒。传 0 表示只手动触发。 */
  intervalMs?: number
  /** 便于测试注入。 */
  fetchImpl?: typeof fetch
  onEvent?: (e: SyncEvent) => void
}
