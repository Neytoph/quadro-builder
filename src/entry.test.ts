import { describe, expect, it } from 'vitest'
import { dropParam, readEntry } from './entry'
import { appendTab } from './store/tabs'

describe('?new=1 新开一个空白标签页', () => {
  it('托管版带 ?new=1 要新开', () => {
    expect(readEntry('?new=1', '', true).blank).toBe(true)
  })

  it('别的值、没带、开源本地版都不开', () => {
    expect(readEntry('?new=0', '', true).blank).toBe(false)
    expect(readEntry('', '', true).blank).toBe(false)
    expect(readEntry('?new=1', '', false).blank).toBe(false)
  })

  it('新开的一页排在最后、成为前台，已开的都留着、顺序不变', () => {
    const open = [{ tabId: 'a', name: '客厅小屋' }, { tabId: 'b', name: '共享的一座' }]
    const blank = { tabId: 'c', name: '未命名' }
    const next = appendTab(open, blank)
    expect(next.tabs.map(x => x.tabId)).toEqual(['a', 'b', 'c'])
    expect(next.tabs[0]).toBe(open[0])
    expect(next.tabs[1]).toBe(open[1])
    expect(next.active).toBe('c')
    expect(open.map(x => x.tabId)).toEqual(['a', 'b'])
  })

  it('处理完从地址栏去掉，刷新不会再新开一个；别的参数留着', () => {
    history.replaceState(null, '', '/builder/?new=1&plan=p1#s=abc')
    expect(readEntry(location.search, location.hash, true).blank).toBe(true)
    dropParam('new')
    expect(location.pathname).toBe('/builder/')
    expect(location.search).toBe('?plan=p1')
    expect(location.hash).toBe('#s=abc')
    expect(readEntry(location.search, location.hash, true).blank).toBe(false)
  })
})
