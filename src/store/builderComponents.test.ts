import { describe, expect, it, vi } from 'vitest'
import { CONFIRMED_COMPONENTS } from '../engine/componentPack.js'
import { builderComponents, componentDimensions, componentForTool, componentHintKey, type BuilderComponent } from './builderComponents'
import { activateComponent, componentChoices } from './componentChoices'
import { accessoryStrings } from '../ui/accessoryStrings'
import { PART_DE, PART_EN, PART_ZH, colorLabel } from '../names'
import { getLang, setLang } from '../engine/i18n.js'
import type { useEngine } from './EngineContext'

describe('已确认组件目录与真实安装入口', () => {
  it('安装卡与清单的固定配色使用完整三语名称', () => {
    const originalLanguage = getLang()
    for (const language of ['zh', 'en', 'de'] as const) {
      setLang(language)
      for (const part of CONFIRMED_COMPONENTS) if (part.fixedColor) {
        expect(colorLabel(part.fixedColor), `${part.id} ${language}`).not.toMatch(/^#/)
      }
      expect(colorLabel('#39A7DF')).toBe(colorLabel('#39a7df'))
      expect(colorLabel('#2FCB5A')).toBe(({ zh: '经典绿', en: 'Classic green', de: 'Klassisches Grün' })[language])
    }
    setLang(originalLanguage)
  })
  it('全部确认项可搜索与配置，旧板与配件 ID 不重复', () => {
    const api = { catalog: { panels: [{ id: 'panel_40x40', name: 'old panel' }], accessories: [{ id: 'textile', name: 'old textile', qdf: 'textil2' }], connectors: [], tubes: [], curved: [] } } as unknown as ReturnType<typeof useEngine>
    const choices = componentChoices(api, [], key => key)
    expect(new Set(choices.map(choice => choice.key)).size).toBe(choices.length)
    for (const part of CONFIRMED_COMPONENTS) {
      const choice = choices.find(choice => choice.partId === part.id)
      expect(choice, part.id).toBeDefined()
      expect(choice?.action).toEqual(part.placement === 'panel' ? { kind: 'panel', id: part.id } : { kind: 'fitting', id: (part as BuilderComponent).kind || part.id, partId: part.id })
      expect(PART_ZH[part.id]).toBeTruthy()
      expect(PART_EN[part.id]).toBeTruthy()
      expect(PART_DE[part.id]).toBeTruthy()
    }
    expect(choices.some(choice => choice.partId?.includes('suspension_bridge'))).toBe(false)
  })

  it('多向轮沿用原目录的轮分类和原生安装入口', () => {
    expect(builderComponents().some(part => part.id === 'wheel')).toBe(false)
    const catalog = { panels: [], accessories: [{ id: 'wheel', name: 'Multirad', qdf: 'multi-wheel2' }], connectors: [], tubes: [], curved: [] }
    const wheel = componentChoices({ catalog } as unknown as ReturnType<typeof useEngine>, [], key => key).find(choice => choice.partId === 'wheel')!
    expect(wheel.group).toBe('tool.wheels')
    expect(wheel.action).toEqual({ kind: 'fitting', id: 'multi-wheel2', partId: undefined })
    const calls = { setPanel: vi.fn(), setFitting: vi.fn() }
    expect(activateComponent(wheel, { ...calls, readOnly: false } as unknown as ReturnType<typeof useEngine>)).toBe(true)
    expect(calls.setFitting).toHaveBeenCalledWith('multi-wheel2', undefined)
    expect(componentForTool({ mode: 'fitting', panelId: '', fittingKind: 'multi-wheel2', fittingPart: null })).toBeUndefined()
  })

  it('所有安装类型有三语提示且不同板尺寸保留', () => {
    for (const part of builderComponents()) {
      const key = componentHintKey(part)
      for (const language of Object.values(accessoryStrings)) expect(language[key as keyof typeof language], `${part.id} ${key}`).toBeTruthy()
    }
    expect(componentDimensions(builderComponents().find(part => part.id === 'panel_40x20')!)).toBe('40×20')
    expect(componentDimensions(builderComponents().find(part => part.id === 'panel_40x30_climbing')!)).toBe('40×30')
    expect(componentDimensions(builderComponents().find(part => part.id === 'acrylic_panel_40x60')!)).toBe('40×60')
  })
})
