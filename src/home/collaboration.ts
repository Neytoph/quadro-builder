// 共享房间以协作文档为准；未附带房间时仍允许成员使用自己的背景。
export function homeForTab<T>(tab: { planId?: string | null; readOnly?: boolean; view?: { homeContext?: T | null } } | undefined, home: T | null): T | null {
  if (tab?.planId && tab.readOnly && tab.view && Object.hasOwn(tab.view, 'homeContext')) return tab.view.homeContext ?? null
  if (home || !tab?.planId) return home
  return tab.view && Object.hasOwn(tab.view, 'homeContext') ? tab.view.homeContext ?? null : home
}

export function localRoomOnly(planId: string | null | undefined, readOnly: boolean | undefined): boolean {
  return !!planId && !!readOnly
}

export function sharedRoomSnapshot<T extends { roomId: unknown; roomRev: number }>(context: T | null): T | null {
  return context ? { ...structuredClone(context), roomId: null, roomRev: 0 } : null
}
