import { describe, expect, it } from 'vitest'
import { dropParam, readEntry } from './entry'
import { appendTab } from './store/tabs'

describe('嵌入编辑器来源片段',()=>{
  it('私人来源和名称仍按原入口规则解析',()=>{
    const hash='#model-editor?'+new URLSearchParams({src:'/quadro/library/abc/native',name:'复杂造型 & 小屋'}).toString()
    const entry=readEntry('?embedded=model&editorOwner=4',hash,true)
    expect(entry.src).toBe('/quadro/library/abc/native');expect(entry.origin).toBe(entry.src);expect(entry.name).toBe('复杂造型 & 小屋')
  })
  it('协作仍依赖托管配置，片段不会接受额外权限参数或站外来源',()=>{
    const hash='#model-editor?plan=p1&copy=1&src=https%3A%2F%2Fother.test%2Fprivate'
    expect(readEntry('?embedded=model',hash,true).plan).toBe('p1')
    expect(readEntry('?embedded=model',hash,false).plan).toBeNull()
    expect(readEntry('?embedded=model',hash,true).src).toBeNull()
    expect(readEntry('?embedded=model',hash,true).copy).toBe(false)
    expect(readEntry('',hash,true).plan).toBeNull()
  })
  it('完成一次性导入后也移除片段里的来源，刷新继续恢复草稿',()=>{
    history.replaceState(null,'','/builder/?embedded=model&draft=one#model-editor?src=%2Ffile.json&name=one')
    dropParam('src')
    expect(readEntry(location.search,location.hash,true).src).toBeNull()
    expect(readEntry(location.search,location.hash,true).name).toBe('one')
    history.replaceState(null,'','/')
  })
})

describe('锁定模型预览', () => {
  it('保持来源并禁用复制、导出、导入及协作写入入口', () => {
    const entry = readEntry('?view=locked&src=/admin/people/2/designs/3/model&copy=1&export=qdf&import=qdf&plan=p1&invite=i1&createShared=1&delivery=d1&new=1&doc=m1', '', true)
    expect(entry.view).toBe(true)
    expect(entry.lockedView).toBe(true)
    expect(entry.src).toBe('/admin/people/2/designs/3/model')
    expect(entry.copy).toBe(false)
    expect(entry.resume).toBeNull()
    expect(entry.importQdf).toBe(false)
    expect(entry.plan).toBeNull()
    expect(entry.invite).toBeNull()
    expect(entry.delivery).toBeNull()
    expect(entry.createShared).toBe(false)
    expect(entry.blank).toBe(false)
    expect(entry.doc).toBeNull()
  })
  it('普通查看模式保留原行为', () => {
    const entry = readEntry('?view=1&src=/quadro/model&copy=1', '', true)
    expect(entry.view).toBe(true)
    expect(entry.lockedView).toBe(false)
    expect(entry.copy).toBe(true)
  })
})

describe('来源页指定预览背景', () => {
  it('草地和家中场景跟随导入入口，非法值不改变偏好', () => {
    expect(readEntry('?background=grass', '#s=payload', true).background).toBe('grass')
    expect(readEntry('?background=home', '#s=payload', true).background).toBe('home')
    expect(readEntry('?background=blank', '#s=payload', true).background).toBeNull()
    expect(readEntry('', '', true).background).toBeNull()
  })
})

describe('固定版本查看入口', () => {
  it('版本必须绑定方案，开源版本不启用', () => {
    expect(readEntry('?plan=p1&version=17', '', true).version).toBe('17')
    expect(readEntry('?version=17', '', true).version).toBeNull()
    expect(readEntry('?plan=p1&version=17', '', false).version).toBeNull()
  })
  it('嵌入交付预览保留方案和固定版本', () => {
    const entry = readEntry('?plan=p1&version=17&view=1&lang=de', '', true)
    expect(entry.plan).toBe('p1')
    expect(entry.version).toBe('17')
    expect(entry.view).toBe(true)
    expect(entry.lang).toBe('de')
  })
})

describe('创建共享方案入口', () => {
  it('带 src 的创建保留真实导入来源和名称', () => {
    const entry = readEntry('?src=/quadro/models/d1.json&name=双层小屋&createShared=1', '', true)
    expect(entry.createShared).toBe(true)
    expect(entry.src).toBe('/quadro/models/d1.json')
    expect(entry.name).toBe('双层小屋')
    expect(entry.plan).toBeNull()
  })
  it('空白入口独立打开，开源版不启用协作', () => {
    const entry = readEntry('?new=1&createShared=1', '', true)
    expect(entry.blank).toBe(true)
    expect(entry.createShared).toBe(true)
    expect(readEntry('?createShared=1', '', false).createShared).toBe(false)
  })
  it('邀请链接允许仅提供 token，由服务端元数据决定方案和权限', () => {
    const entry = readEntry('?invite=token1&role=owner', '', true)
    expect(entry.invite).toBe('token1')
    expect(entry.plan).toBeNull()
    expect('role' in entry).toBe(false)
  })
})

describe('?export= 注册完回来接着做', () => {
  it('复制分享链接（link）和导出文件一样认', () => {
    expect(readEntry('?export=link', '', true).resume).toBe('link')
    expect(readEntry('?export=manual', '', true).resume).toBe('manual')
    expect(readEntry('?export=nope', '', true).resume).toBeNull()
  })
})

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

describe('?src= 和 &origin= 的出处', () => {
  it('同站路径的 src 既是要打开的文件，也是出处', () => {
    const e = readEntry('?src=/quadro/shares/abc/model.json', '', true)
    expect(e.src).toBe('/quadro/shares/abc/model.json')
    expect(e.origin).toBe('/quadro/shares/abc/model.json')
    expect(e.source).toBeNull()
  })

  it('写了 origin 就用 origin', () => {
    const e = readEntry(`?origin=${encodeURIComponent('/scheme.html?id=7')}`, '#s=payload', true)
    expect(e.src).toBeNull()
    expect(e.origin).toBe('/scheme.html?id=7')
  })

  it('来源标记不是出处，别的站点的地址也不认', () => {
    const e = readEntry('?plan=p1&src=plan:p1', '', true)
    expect(e.source).toBe('plan:p1')
    expect(e.src).toBeNull()
    expect(e.origin).toBeNull()
    expect(readEntry('?origin=//evil.example/x', '', true).origin).toBeNull()
  })
})
