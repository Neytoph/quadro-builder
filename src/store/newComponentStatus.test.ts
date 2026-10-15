import { expect, it } from 'vitest'
import { CONFIRMED_COMPONENTS } from '../engine/componentPack.js'
import { INSTALLATION_CATALOGUE } from './installationCatalogue'
import { NEW_COMPONENT_IDS, UPDATED_COMPONENT_IDS, NEW_COMPONENT_STATUS, isNewComponent } from './newComponentStatus'
import { installationCatalogueStrings } from '../ui/installationCatalogueStrings'

it('本轮36件：35确认目录减4基础板，另加方向盘/忙碌板/布兜和2铝管', () => {
  const retained = new Set(['panel_40x40','panel_40x20','panel_30x30','hole_panel_40x40'])
  const expected = new Set([...CONFIRMED_COMPONENTS.filter(part => !retained.has(part.id)).map(part => part.id), 'steering_wheel','panel_40x40_busy','panel_40x40_pocket','TA35','TA75'])
  expect(NEW_COMPONENT_STATUS).toEqual(expected)
  expect(NEW_COMPONENT_STATUS.size).toBe(36)
  expect(NEW_COMPONENT_IDS).toHaveLength(21)
  expect(UPDATED_COMPONENT_IDS).toHaveLength(15)
  expect(NEW_COMPONENT_IDS.filter(id => (UPDATED_COMPONENT_IDS as readonly string[]).includes(id))).toEqual([])
  for (const id of NEW_COMPONENT_STATUS) expect(INSTALLATION_CATALOGUE.some(part => part.id === id), id).toBe(true)
})

it('来源与新状态独立，外扣12新/4既有，旧扩展与原秋千/吊环/彩虹门不标新', () => {
  const outer = INSTALLATION_CATALOGUE.filter(part => part.group === 'outside')
  expect(outer.filter(part => isNewComponent(part.id))).toHaveLength(12)
  for (const id of ['panel_40x40','panel_40x20','panel_30x30','hole_panel_40x40','swing','gym_rings','textile_rainbow','textile_20x40','roof','tube_cap','wheel']) expect(isNewComponent(id), id).toBe(false)
  const official = INSTALLATION_CATALOGUE.filter(part => part.origin === 'official')
  expect(official.filter(part => isNewComponent(part.id)).map(part => part.id)).toEqual(['textile','textile_round','lattice'])
  expect(isNewComponent('unregistered')).toBe(false)
})

it('三语角标与完整可及名称独立提供', () => {
  expect(Object.values(installationCatalogueStrings).map(copy => copy.newBadge)).toEqual(['新','New','Neu'])
  expect(Object.values(installationCatalogueStrings).map(copy => copy.newComponent)).toEqual(['新组件','New component','Neues Bauteil'])
})
