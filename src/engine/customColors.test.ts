import { beforeAll, describe, expect, it } from 'vitest'
import { BuildModel } from './model.js'
import { Builder } from './builder.js'
import { loadCatalog } from './catalog.js'
import { colorPreviewModel, modelColors, normalizeColor, customColorSlots, selectionColor } from './customColors.js'
import { ModelHistory } from '../collab/history'
import { docFromJSON } from '../collab/ymodel'

beforeAll(async () => { await loadCatalog() })

// 使用真实模型和 Yjs 历史；此处隔离渲染，完整预览另在浏览器检查。
function editor(mode = 'select') {
  const model = new BuildModel()
  const node = model.addNode(0, 60, 0)
  const tube = model.extend(node.id, [1, 0, 0], 'T35', 'red', 35, 40)!.tube!
  const other = model.extend(node.id, [0, 0, 1], 'T35', 'blue', 35, 40)!.tube!
  const builder = Object.create(Builder.prototype)
  Object.assign(builder, { model, mode, color: 'blue', selection: new Map([[tube.id, 'tube']]), stepFrom: [],
    refresh: () => {}, onNotice: () => {}, onHistoryChange: () => {} })
  builder.setHistory(new ModelHistory(docFromJSON(model.toJSON())))
  return { model, builder, tube, other }
}

describe('自定义颜色预览与真实历史', () => {
  it('拖动多次只改变渲染副本，取消不修改原模型或文档', () => {
    const { model, builder, tube } = editor()
    const before = JSON.stringify(model.toJSON())
    builder.beginColorPreview()
    for (const hex of ['#ABCDEF', '#765432', '#FF00FF']) builder.previewColor(hex)
    const preview = colorPreviewModel(model, builder._colorPreview.selection, '#FF00FF')
    expect(preview.tubes.get(tube.id)!.color).toBe('#FF00FF')
    expect(model.tubes.get(tube.id)!.color).toBe('red')
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(JSON.stringify(builder.history.toJSON())).toBe(before)
    builder.finishColorPreview()
    expect(builder.color).toBe('blue')
    expect(builder.history.canUndo()).toBe(false)
  })
  it('确认产生一条撤销，重做精确恢复，自定义色随原生模型重开保留', () => {
    const { model, builder, tube, other } = editor()
    builder.beginColorPreview()
    for (const hex of ['#123456', '#778899', '#ABCDEF']) builder.previewColor(hex)
    expect(builder.finishColorPreview('#ABCDEF')).toBe(true)
    expect(model.tubes.get(tube.id)!.color).toBe('#ABCDEF')
    expect(model.tubes.get(other.id)!.color).toBe('blue')
    const reopened = new BuildModel()
    expect(reopened.loadJSON(model.toJSON()).ok).toBe(true)
    expect(reopened.tubes.get(tube.id)!.color).toBe('#ABCDEF')
    builder.history.undo()
    expect(model.tubes.get(tube.id)!.color).toBe('red')
    expect(builder.history.canUndo()).toBe(false)
    builder.history.redo()
    expect(model.tubes.get(tube.id)!.color).toBe('#ABCDEF')
  })
  it('搭建模式只更新后续零件颜色，无选择时不产生历史', () => {
    const { model, builder } = editor('add')
    const before = JSON.stringify(model.toJSON())
    builder.beginColorPreview(); builder.previewColor('#AABBCC'); builder.finishColorPreview('#AABBCC')
    expect(builder.colorFor('tube', null)).toBe('#AABBCC')
    expect(JSON.stringify(model.toJSON())).toBe(before)
    expect(builder.history.canUndo()).toBe(false)
  })
  it('外部修改终止旧预览，确认不会覆盖新状态', () => {
    const { model, builder, tube } = editor()
    builder.beginColorPreview(); builder.previewColor('#AABBCC')
    const changed = model.toJSON()
    changed.tubes.find((part: { id: string }) => part.id === tube.id)!.color = '#665544'
    builder.applyExternal(changed)
    expect(builder.finishColorPreview('#AABBCC')).toBe(false)
    expect(model.tubes.get(tube.id)!.color).toBe('#665544')
    expect(builder.history.canUndo()).toBe(false)
  })
  it('只读、忙碌与分步模式不打开调色预览', () => {
    const { builder } = editor()
    builder.readOnly = true; expect(builder.beginColorPreview()).toBe(false)
    builder.readOnly = false; builder.held = true; expect(builder.beginColorPreview()).toBe(false)
    builder.held = false; builder.mode = 'assembly'; expect(builder.beginColorPreview()).toBe(false)
  })
  it('固定颜色的管件和配件在预览与全部同色时保持', () => {
    const { model, builder, tube } = editor()
    tube.tubeId = 'TA35'
    const fixed = { id: 'fixed', kind: 'bearing2', color: 'black' }
    model.fittings.set(fixed.id, fixed as never)
    const preview = colorPreviewModel(model, new Map([[tube.id, 'tube'], [fixed.id, 'fitting']]), '#AABBCC')
    expect(preview.tubes.get(tube.id)!.color).toBe('red')
    expect(preview.fittings.get(fixed.id)!.color).toBe('black')
    builder.recolorAll(['#AABBCC'])
    expect(model.tubes.get(tube.id)!.color).toBe('red')
    expect(model.fittings.get(fixed.id)!.color).toBe('black')
    expect(modelColors(model)).toContain('#B9C0C5')
    expect(selectionColor(model, new Map([[tube.id, 'tube']]))).toBe('#B9C0C5')
  })
})

describe('颜色复用', () => {
  it('色号支持粘贴、简写、大小写并拒绝非法输入', () => {
    expect(normalizeColor(' abc ')).toBe('#AABBCC')
    expect(normalizeColor('#ab12EF')).toBe('#AB12EF')
    for (const input of ['#12345', '#12345678', 'red', '#12GG00', null]) expect(normalizeColor(input)).toBeNull()
  })
  it('四个固定槽位规范化色号，保留空位、顺序及重复值', () => {
    expect(customColorSlots([])).toEqual([null, null, null, null])
    expect(customColorSlots(['#abc', null, '#AABBCC', '#123456', '#654321'])).toEqual(['#AABBCC', null, '#AABBCC', '#123456'])
    expect(customColorSlots(['invalid', '#abc'])).toEqual([null, '#AABBCC', null, null])
  })
  it('造型颜色包含自定义色并合并同色的不同写法', () => {
    const { model, tube, other } = editor()
    tube.color = '#abc'; other.color = '#AABBCC'
    expect(modelColors(model)).toEqual(['#AABBCC'])
  })
})
