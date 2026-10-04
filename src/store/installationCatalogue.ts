import type { useEngine } from './EngineContext'
import { componentChoices, activateComponent, type ComponentChoice } from './componentChoices'
import { builderComponents, selectBuilderComponent } from './builderComponents'

export type CatalogueTool = 'panels' | 'accessories' | 'textiles' | 'wheels' | 'slides' | 'pools' | 'tubes' | 'connectors'
export type CatalogueEntry = { id: string; origin: 'official' | 'extended'; group: string; tool: CatalogueTool; method: string; aliases: string }
// 用户确认的91件唯一归属与已核对来源；来源独立于运行时compat。
export const INSTALLATION_CATALOGUE: readonly CatalogueEntry[] = [
  {
    "id": "panel_40x40",
    "origin": "official",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x20",
    "origin": "official",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_30x30",
    "origin": "official",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "hole_panel_40x40",
    "origin": "official",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": "洞洞 九孔 九洞"
  },
  {
    "id": "panel_40x40_lego",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": "乐高 积木 拼插 LEGO"
  },
  {
    "id": "panel_40x40_honeycomb",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x40_magnet",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x40_climbing",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x30_climbing",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x20_climbing",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x40_clock",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x40_maze",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x40_basketball",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": "篮球架 篮球框 篮球筐"
  },
  {
    "id": "panel_40x40_felt",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_40x20_castle",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "外侧固定",
    "aliases": ""
  },
  {
    "id": "panel_sector_40",
    "origin": "extended",
    "group": "outside",
    "tool": "panels",
    "method": "角部固定",
    "aliases": ""
  },
  {
    "id": "acrylic_panel_40x40",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "acrylic_panel_40x20",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "acrylic_panel_40x60",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "acrylic_hole_panel_40x40",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": "透明 洞洞 九孔"
  },
  {
    "id": "panel_40x40_capsule",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": "透明罩 半球 太空舱"
  },
  {
    "id": "panel_40x40_grid",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "panel_40x40_busy",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "acrylic_platform_40x40",
    "origin": "extended",
    "group": "inset",
    "tool": "panels",
    "method": "对边螺丝",
    "aliases": ""
  },
  {
    "id": "swing",
    "origin": "extended",
    "group": "on-tube",
    "tool": "accessories",
    "method": "吊挂",
    "aliases": ""
  },
  {
    "id": "gym_rings",
    "origin": "extended",
    "group": "on-tube",
    "tool": "accessories",
    "method": "吊挂",
    "aliases": ""
  },
  {
    "id": "steering_wheel",
    "origin": "extended",
    "group": "on-tube",
    "tool": "accessories",
    "method": "夹装",
    "aliases": ""
  },
  {
    "id": "sleeve",
    "origin": "extended",
    "group": "on-tube",
    "tool": "accessories",
    "method": "穿管",
    "aliases": ""
  },
  {
    "id": "panel_40x40_sensory",
    "origin": "extended",
    "group": "on-frame",
    "tool": "accessories",
    "method": "平铺",
    "aliases": ""
  },
  {
    "id": "panel_40x40_basin",
    "origin": "extended",
    "group": "on-frame",
    "tool": "accessories",
    "method": "承托",
    "aliases": ""
  },
  {
    "id": "textile_bridge",
    "origin": "extended",
    "group": "on-frame",
    "tool": "accessories",
    "method": "跨框固定",
    "aliases": ""
  },
  {
    "id": "rope",
    "origin": "extended",
    "group": "auxiliary",
    "tool": "accessories",
    "method": "穿接",
    "aliases": "绳子 荡桥 悬索 用户组合"
  },
  {
    "id": "tube_cap",
    "origin": "official",
    "group": "auxiliary",
    "tool": "accessories",
    "method": "封口",
    "aliases": ""
  },
  {
    "id": "open_end",
    "origin": "official",
    "group": "auxiliary",
    "tool": "accessories",
    "method": "穿接",
    "aliases": ""
  },
  {
    "id": "textile",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "textile_long",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "textile_20x40",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "textile_round",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "textile_round_fourway",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "textile_rainbow",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": "彩虹门 彩虹带"
  },
  {
    "id": "roof",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "roof_large",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "bag",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "悬挂",
    "aliases": ""
  },
  {
    "id": "panel_40x40_pocket",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "套管",
    "aliases": ""
  },
  {
    "id": "lattice",
    "origin": "official",
    "group": "textile",
    "tool": "textiles",
    "method": "张紧",
    "aliases": ""
  },
  {
    "id": "lattice_curved",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "张紧",
    "aliases": ""
  },
  {
    "id": "trampoline",
    "origin": "extended",
    "group": "textile",
    "tool": "textiles",
    "method": "张紧",
    "aliases": ""
  },
  {
    "id": "wheel_bearing",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "轴端安装",
    "aliases": ""
  },
  {
    "id": "wheel",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "管上或轴承",
    "aliases": "多向轮 多轮 multi wheel Multirad"
  },
  {
    "id": "wheel_floating",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "轴端安装",
    "aliases": ""
  },
  {
    "id": "hub_cap",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "轴端安装",
    "aliases": ""
  },
  {
    "id": "caster",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "节点安装",
    "aliases": ""
  },
  {
    "id": "steering_lock",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "轴端安装",
    "aliases": ""
  },
  {
    "id": "wheel_adapter",
    "origin": "official",
    "group": "wheels",
    "tool": "wheels",
    "method": "适配连接",
    "aliases": ""
  },
  {
    "id": "slide_integral",
    "origin": "official",
    "group": "slides",
    "tool": "slides",
    "method": "挂接",
    "aliases": ""
  },
  {
    "id": "slide_module",
    "origin": "official",
    "group": "slides",
    "tool": "slides",
    "method": "挂接",
    "aliases": ""
  },
  {
    "id": "slide_curved",
    "origin": "official",
    "group": "slides",
    "tool": "slides",
    "method": "挂接",
    "aliases": ""
  },
  {
    "id": "slide_end",
    "origin": "official",
    "group": "slides",
    "tool": "slides",
    "method": "连接",
    "aliases": ""
  },
  {
    "id": "pool_liner_xs",
    "origin": "official",
    "group": "pools",
    "tool": "pools",
    "method": "铺设",
    "aliases": ""
  },
  {
    "id": "pool_liner_s",
    "origin": "official",
    "group": "pools",
    "tool": "pools",
    "method": "铺设",
    "aliases": ""
  },
  {
    "id": "pool_liner_l",
    "origin": "official",
    "group": "pools",
    "tool": "pools",
    "method": "铺设",
    "aliases": ""
  },
  {
    "id": "pool_liner_xxl",
    "origin": "official",
    "group": "pools",
    "tool": "pools",
    "method": "铺设",
    "aliases": ""
  },
  {
    "id": "balls",
    "origin": "official",
    "group": "pools",
    "tool": "pools",
    "method": "填充",
    "aliases": ""
  },
  {
    "id": "TA35",
    "origin": "extended",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "TA75",
    "origin": "extended",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T10",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T15",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T20",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T25",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T35",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T52",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "T75",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "TC1",
    "origin": "official",
    "group": "tubes",
    "tool": "tubes",
    "method": "两端连接",
    "aliases": ""
  },
  {
    "id": "6way",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "5way",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "4way",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "3way",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "cross",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "t",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "straight",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "elbow",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "diagonal",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "flexi",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "flexi_hinge",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "flexi_bolt",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "hole_t",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "hole_2",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "hole_1",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "bearing",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "double_tube",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  },
  {
    "id": "tube_clamp",
    "origin": "official",
    "group": "connectors",
    "tool": "connectors",
    "method": "节点连接",
    "aliases": ""
  }
]

type EngineApi = ReturnType<typeof useEngine>
export type CatalogueChoice = CatalogueEntry & { choice: ComponentChoice }

export function installationChoices(api: EngineApi, t: (key: string) => string): CatalogueChoice[] {
  const choices = componentChoices(api, [], t)
  return INSTALLATION_CATALOGUE.map(entry => {
    const choice = choices.find(choice => choice.partId === entry.id)
    if (!choice) throw new Error(`安装目录缺少实际组件：${entry.id}`)
    return { ...entry, choice }
  })
}

const SEARCH_ALIASES: Record<string, string> = {
  rope: 'suspension bridge rope Hängebrücke Seil',
  panel_40x40_lego: 'lego building blocks Bausteine',
  panel_40x40_capsule: 'space capsule hemisphere dome Raumkapsel Halbkugel',
  panel_40x40_basketball: 'basketball hoop Basketballkorb',
  hole_panel_40x40: 'nine holes perforated Neunloch Lochplatte',
  acrylic_hole_panel_40x40: 'clear transparent nine holes transparente Neunlochplatte',
  textile_rainbow: 'rainbow gate Regenbogentor',
}
export function searchInstallation(entry: CatalogueChoice, query: string): boolean {
  const text = `${entry.id} ${entry.choice.label} ${entry.aliases} ${SEARCH_ALIASES[entry.id] || ''}`.toLocaleLowerCase().normalize('NFKC')
  return query.trim().toLocaleLowerCase().normalize('NFKC').split(/\s+/).every(word => text.includes(word))
}

export function selectInstallation(entry: CatalogueChoice, api: EngineApi): boolean {
  if (api.readOnly) return false
  const confirmed = builderComponents().find(part => part.id === entry.id)
  if (confirmed) { selectBuilderComponent(confirmed, api); return true }
  return activateComponent(entry.choice, api)
}

export function installationActive(entry: CatalogueChoice, api: EngineApi): boolean {
  const action = entry.choice.action
  if (!action) return false
  switch (action.kind) {
    case 'panel': return api.mode === 'panel' && api.panelId === action.id
    case 'tube': return api.mode === 'add' && !api.placingConnector && api.tubeId === action.id
    case 'slide': return api.mode === 'slide' && api.slideKind === action.id
    case 'clamp': return api.mode === 'clamp' && api.clampPart === action.id
    case 'connector': return !!api.placingConnector && api.placingConnector === action.id
    case 'fitting': return api.mode === 'fitting' && api.fittingKind === action.id && (action.partId ? api.fittingPart === action.partId : !api.fittingPart)
    case 'pool': return api.poolLinerId === action.id && (api.mode === 'fitting' || api.pasting)
    case 'c45': return api.mode === 'c45'
    default: return false
  }
}
