import { BUILDER_COMPONENT_PACK, ACCESSORY_PACK } from '../engine/accessoryPack.js'
import { CONFIRMED_COMPONENTS } from '../engine/componentPack.js'
import type { useEngine } from './EngineContext'

export type BuilderComponent = {
  id: string
  name: string
  placement: string
  kind?: string
  mount?: string
  mountType?: string
  width?: number
  height?: number
  depth?: number
  assumption?: string
  appearanceVersion?: number
  fixedColor?: string
  mountLayout?: string
}

/** 只从引擎目录取组件及其安装入口，重复 ID 使用最新确认规格。 */
export function builderComponents(): BuilderComponent[] {
  return [...new Map([...ACCESSORY_PACK, ...BUILDER_COMPONENT_PACK, ...CONFIRMED_COMPONENTS].map(part => [part.id, part])).values()]
}

export function componentForTool(api: Pick<ReturnType<typeof useEngine>, 'mode' | 'panelId' | 'fittingPart' | 'fittingKind'>): BuilderComponent | undefined {
  const id = api.mode === 'panel' ? api.panelId : api.mode === 'fitting' ? api.fittingPart || api.fittingKind : ''
  return builderComponents().find(part => part.id === id || part.kind === id)
}

export function selectBuilderComponent(part: BuilderComponent, api: Pick<ReturnType<typeof useEngine>, 'setPanel' | 'setFitting'>) {
  if (part.placement === 'panel') api.setPanel(part.id)
  else api.setFitting(part.kind || part.id, part.id)
}

export function componentDimensions(part: BuilderComponent) {
  return part.placement === 'panel' && part.width && part.height ? `${part.width}×${part.height}` : ''
}

export function componentHintKey(part: BuilderComponent) {
  if (part.mountLayout === 'opposite-transparent-screws') return 'accessory.mount.opposite-screws'
  if (['steering_wheel', 'swing', 'gym_rings', 'panel_40x40_busy', 'panel_40x40_pocket', 'trampoline'].includes(part.id)) return `accessory.hint.${part.id}`
  if (part.id === 'sleeve') return 'accessory.hint.roller'
  const mount = part.mountType || part.mount || 'frame'
  return `accessory.mount.${mount}`
}
