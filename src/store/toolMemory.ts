import type { CatalogueChoice, CatalogueTool } from './installationCatalogue'
import { installationActive } from './installationCatalogue'

export type BuilderTool = CatalogueTool
export const CATALOGUE_TOOLS: CatalogueTool[] = ['tubes', 'panels', 'connectors', 'wheels', 'textiles', 'pools', 'slides', 'accessories', 'reinforce']
export const TOOL_LABELS: Record<BuilderTool, string> = {
  tubes: 'tool.tubes', panels: 'tool.panels', connectors: 'tool.connections', wheels: 'tool.wheels',
  textiles: 'tool.textiles', pools: 'tool.pools', slides: 'tool.slides', accessories: 'tool.accessories', reinforce: 'tool.reinforce',
}
export const NUMBER_TUBES: Record<string, string> = { '1': 'T15', '2': 'T25', '3': 'T35' }

export type ToolState = Parameters<typeof installationActive>[1] & { color: string; insetScrewAxis: 'auto' | 'vertical' | 'horizontal' }
export type ToolSnapshot = {
  tool: BuilderTool
  partId: string
  color: string
  insetScrewAxis: 'auto' | 'vertical' | 'horizontal'
  fittingPart?: string | null
}

export function captureTool(state: ToolState, entries: CatalogueChoice[]): ToolSnapshot | null {
  if (state.pasting) return null
  const entry = entries.find(entry => installationActive(entry, state))
  let tool: BuilderTool | undefined = entry?.tool
  if (state.mode === 'reinforce') tool = 'reinforce'
  if (state.mode === 'slide') tool = 'slides'
  if (!tool) return null
  return { tool, partId: tool === 'slides' ? state.slideKind : entry?.id || 'reinforce', color: state.color,
    insetScrewAxis: state.insetScrewAxis, fittingPart: state.mode === 'fitting' ? state.fittingPart : null }
}

// 仅保存在当前页面内；模型内容、撤销记录和服务器同步均不包含工具记忆。
export class ToolMemory {
  private tabs = new Map<string, { last: ToolSnapshot; tools: Map<BuilderTool, ToolSnapshot> }>()
  remember(tabId: string | null, snapshot: ToolSnapshot | null) {
    if (!tabId || !snapshot) return
    const tab = this.tabs.get(tabId) || { last: snapshot, tools: new Map() }
    tab.last = { ...snapshot }
    tab.tools.set(snapshot.tool, { ...snapshot })
    this.tabs.set(tabId, tab)
  }
  get(tabId: string | null, tool?: BuilderTool): ToolSnapshot | undefined {
    const tab = tabId ? this.tabs.get(tabId) : undefined
    const snapshot = tool ? tab?.tools.get(tool) : tab?.last
    return snapshot && { ...snapshot }
  }
  retain(tabIds: string[]) {
    for (const id of this.tabs.keys()) if (!tabIds.includes(id)) this.tabs.delete(id)
  }
}
