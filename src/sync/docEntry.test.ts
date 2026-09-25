import { describe, expect, it } from 'vitest'
import * as docs from '../engine/docs.js'
import { hasLocalDoc, pickRemote, pullDoc } from './docEntry'
import type { RemoteDoc } from './types'

const data = { tubes: [], nodes: [] }
const remote = (id: string, extra: Partial<RemoteDoc> = {}): RemoteDoc =>
  ({ id, name: `造型 ${id}`, data, createdAt: 1, updatedAt: 2, rev: 3, ...extra })

describe('?doc= 打开自己的一座', () => {
  it('服务端列表里挑出这一座', () => {
    const items = [remote('a'), remote('b')]
    expect(pickRemote(items, 'b')?.id).toBe('b')
  })

  it('服务端列表里没有（不是自己的）就是找不到', () => {
    expect(pickRemote([remote('a')], 'x')).toBeNull()
  })

  it('服务端已经删掉的算找不到', () => {
    expect(pickRemote([remote('a', { deletedAt: 5, data: null })], 'a')).toBeNull()
  })

  it('本机有这一座', async () => {
    const d = await docs.saveDoc({ docId: undefined, name: '本机的一座', data })
    expect(await hasLocalDoc(d.id)).toBe(true)
    expect(await hasLocalDoc('nope')).toBe(false)
  })

  it('本机删掉还没同步的墓碑不算有', async () => {
    docs.setSyncMode(true)
    await docs.putRemoteDoc(remote('tomb'))
    await docs.removeDoc('tomb')
    docs.setSyncMode(false)
    expect(await hasLocalDoc('tomb')).toBe(false)
  })

  it('本机有就直接打开，不去服务端拉', async () => {
    const d = await docs.saveDoc({ docId: undefined, name: '不用拉', data })
    // 这个地址连不上：真去拉就会失败
    expect(await pullDoc('http://127.0.0.1:1', d.id)).toBe(true)
  })

  it('服务端那一座放进本机以后就能打开', async () => {
    const doc = pickRemote([remote('from-server')], 'from-server')!
    await docs.putRemoteDoc(doc)
    expect(await hasLocalDoc('from-server')).toBe(true)
    expect((await docs.getDoc('from-server') as { name: string }).name).toBe('造型 from-server')
  })
})
