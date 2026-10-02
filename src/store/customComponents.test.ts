import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { BuildModel } from '../engine/model.js'
import { listComponents, readComponentConfiguration, removeComponent, saveComponent, saveComponentConfiguration } from './customComponents'

it('本地保存保留真实片段、重命名保留组件身份，删除后不再出现', async () => {
  const model = new BuildModel()
  const node = model.addNode(0, 0, 0)
  const fragment = model.extractSelection(new Map([[node.id, 'node']]))!
  const row = { id: 'test-component', name: '单接头', fragment, updatedAt: 1 }
  await saveComponent(row)
  // 测试使用隔离的内存 IndexedDB，业务持久化另由真实浏览器验收。
  const first = await listComponents()
  expect(first).toEqual([row])
  first[0].fragment.anchor[0] = 999
  expect((await listComponents())[0].fragment.anchor[0]).toBe(0)
  await saveComponent({ ...row, name: '改名后的接头' })
  expect((await listComponents()).map(item => [item.id, item.name])).toEqual([['test-component', '改名后的接头']])
  expect(await readComponentConfiguration()).toBeNull()
  await saveComponentConfiguration(['panel:panel_40x40', `saved:${row.id}`, 'panel:panel_40x40'])
  expect(await readComponentConfiguration()).toEqual(['panel:panel_40x40', `saved:${row.id}`])
  await removeComponent(row.id)
  expect(await listComponents()).toEqual([])
  expect(await readComponentConfiguration()).toEqual(['panel:panel_40x40'])
  await saveComponentConfiguration([])
  expect(await readComponentConfiguration()).toEqual([])
})
