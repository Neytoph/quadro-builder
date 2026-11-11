export type SafetyLevel = 'error' | 'warn' | 'info'
export interface SafetyFinding {
  rule: string
  level: SafetyLevel
  ref: string
  params: Record<string, unknown>
  ids: { nodes?: string[]; tubes?: string[]; panels?: string[] }
}
export interface SafetyResult {
  findings: SafetyFinding[]
  height: number
}
export interface SafetyOptions {
  room: { w: number; d: number } | null
  indoor: boolean
}
