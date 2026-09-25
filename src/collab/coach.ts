// 第一次进共享方案的提示气泡：谁看哪几步、看过没有。
// 成员（创建人、编辑者、评论者）三步；访客两步，第一步指着顶上的只读横条，说怎样才能写意见。
// 看过记在本机，成员和访客各一个键：访客后来加入成为成员，还会看到一次完整的三步。
import type { DockPane } from '../ui/dock'
import type { Prefer } from '../ui/CoachFrame'
import type { Plan } from './api'

export const COACH_KEY = 'quadro.builder.collab-coach.v1'
export const COACH_GUEST_KEY = 'quadro.builder.collab-coach-guest.v1'

/** member：方案成员；visitor：没登录；outsider：登录了但不是成员 */
export type CoachKind = 'member' | 'visitor' | 'outsider'

export interface CoachStep {
  id: 'pin' | 'login' | 'join' | 'chat' | 'versions'
  title: string
  body: string
  hint?: string
  /** 光圈套住的 data-tour */
  tour: string
  prefer: Prefer
  pane: DockPane | null
}

export function coachKind(plan: Plan): CoachKind {
  if (plan.myRole !== 'guest') return 'member'
  return plan.me ? 'outsider' : 'visitor'
}

function keyOf(kind: CoachKind) {
  return kind === 'member' ? COACH_KEY : COACH_GUEST_KEY
}

export function coachSeen(kind: CoachKind): boolean {
  return localStorage.getItem(keyOf(kind)) === '1'
}

export function markCoachSeen(kind: CoachKind) {
  localStorage.setItem(keyOf(kind), '1')
}

/** narrow：手机宽度，评论抽屉在顶栏下面铺满，第二步的标题跟着换；brief：需求单建的方案，留言区第一条是需求单 */
export function coachSteps(kind: CoachKind, narrow: boolean, brief: boolean): CoachStep[] {
  const chat: CoachStep = {
    id: 'chat', title: narrow ? 'coach.chat.titleBelow' : 'coach.chat.titleRight', body: brief ? 'coach.chat.bodyBrief' : 'coach.chat.body',
    tour: 'dock-panel', prefer: narrow ? 'top' : 'left', pane: 'comments',
  }
  if (kind === 'visitor') {
    return [{ id: 'login', title: 'coach.login.title', body: 'coach.login.body', tour: 'read-only-banner', prefer: 'bottom', pane: null }, chat]
  }
  if (kind === 'outsider') {
    return [{ id: 'join', title: 'coach.join.title', body: 'coach.join.body', tour: 'read-only-banner', prefer: 'bottom', pane: null }, chat]
  }
  return [
    { id: 'pin', title: 'coach.pin.title', body: 'coach.pin.body', hint: 'coach.pin.hint', tour: 'tool-comment', prefer: 'bottom', pane: null },
    chat,
    { id: 'versions', title: 'coach.versions.title', body: 'coach.versions.body', tour: 'dock-versions', prefer: 'bottom', pane: null },
  ]
}
