import { beforeEach, describe, expect, it } from 'vitest'
import { dicts, LANGS } from '../i18n'
import type { Plan } from './api'
import { COACH_GUEST_KEY, COACH_KEY, coachKind, coachSeen, coachSteps, markCoachSeen } from './coach'

function plan(myRole: Plan['myRole'], me: boolean): Plan {
  return {
    id: 'p1', name: '次卧滑梯屋', data: null, qdf: '', members: [], myRole, briefId: null,
    me: me ? { userId: 7, name: '林晓', avatar: '', lastReadAt: 0 } : null,
  }
}

beforeEach(() => localStorage.clear())

describe('谁看哪几步', () => {
  it('创建人、编辑者、评论者都是成员，看三步', () => {
    for (const role of ['owner', 'editor', 'commenter'] as const) {
      expect(coachKind(plan(role, true))).toBe('member')
    }
    expect(coachSteps('member', false, false).map(s => s.id)).toEqual(['pin', 'chat', 'versions'])
  })

  it('没登录的访客看两步，第一步是登录后可以写意见，指着只读横条', () => {
    expect(coachKind(plan('guest', false))).toBe('visitor')
    const steps = coachSteps('visitor', false, false)
    expect(steps.map(s => s.id)).toEqual(['login', 'chat'])
    expect(steps[0].title).toBe('coach.login.title')
    expect(steps[0].tour).toBe('read-only-banner')
  })

  it('登录了但不是成员，第一步换成请人发邀请链接', () => {
    expect(coachKind(plan('guest', true))).toBe('outsider')
    const steps = coachSteps('outsider', false, false)
    expect(steps.map(s => s.id)).toEqual(['join', 'chat'])
    expect(steps[0].body).toBe('coach.join.body')
  })

  it('第一步指着「评论」工具，第二步替人打开评论抽屉，第三步指着顶栏「版本」', () => {
    const [pin, chat, versions] = coachSteps('member', false, false)
    expect(pin.tour).toBe('tool-comment')
    expect(pin.pane).toBeNull()
    expect(chat.pane).toBe('comments')
    expect(chat.tour).toBe('dock-panel')
    expect(versions.tour).toBe('dock-versions')
    expect(versions.pane).toBeNull()
  })

  it('手机宽度第二步的标题换成「在下面」，气泡放在上面', () => {
    expect(coachSteps('member', false, false)[1]).toMatchObject({ title: 'coach.chat.titleRight', prefer: 'left' })
    expect(coachSteps('member', true, false)[1]).toMatchObject({ title: 'coach.chat.titleBelow', prefer: 'top' })
  })

  it('需求单建的方案才说第一条留言是需求单', () => {
    expect(coachSteps('member', false, false)[1].body).toBe('coach.chat.body')
    expect(coachSteps('member', false, true)[1].body).toBe('coach.chat.bodyBrief')
  })
})

describe('每个人只出一次', () => {
  it('看完或跳过以后不再出', () => {
    expect(coachSeen('member')).toBe(false)
    markCoachSeen('member')
    expect(coachSeen('member')).toBe(true)
    expect(localStorage.getItem(COACH_KEY)).toBe('1')
  })

  it('访客看过记在另一个键；之后加入成为成员，还会看到完整的三步', () => {
    markCoachSeen('visitor')
    expect(localStorage.getItem(COACH_GUEST_KEY)).toBe('1')
    expect(coachSeen('visitor')).toBe(true)
    expect(coachSeen('outsider')).toBe(true)
    expect(coachSeen('member')).toBe(false)
  })

  it('成员看过，不影响还没看过的访客那一份', () => {
    markCoachSeen('member')
    expect(coachSeen('visitor')).toBe(false)
  })
})

describe('三语文案', () => {
  it('每一步用到的字在三种语言里都有', () => {
    const keys = new Set<string>(['coach.kicker', 'coach.done'])
    for (const kind of ['member', 'visitor', 'outsider'] as const) {
      for (const narrow of [false, true]) {
        for (const brief of [false, true]) {
          for (const s of coachSteps(kind, narrow, brief)) {
            keys.add(s.title)
            keys.add(s.body)
            if (s.hint) keys.add(s.hint)
          }
        }
      }
    }
    for (const { id } of LANGS) {
      for (const k of keys) expect(dicts[id][k], `${id} ${k}`).toBeTruthy()
    }
  })
})
