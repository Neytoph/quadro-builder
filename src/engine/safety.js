/**
 * 安全审查：按 QUADRO 官方《Sicherheit · Safety》须知逐条检查模型。
 *
 * 每条规则带 `ref`（须知里的章节号）；引擎自己加的两条（没落地、高处没护栏）
 * 标 `ref: "builder"`。结果只做参考，界面上的措辞不写「合格」。
 *
 * 规则：
 *   open_end     1.1  每根管两头都要接接头，不允许留空的管端
 *   deck_edges   1.3  只有四边都拧在管上的板才能承重
 *   entrapment   2    60 cm 以上，35×15 的开口要用半板封上（勒颈风险）
 *   level_gap    6    可攀爬的结构，层与层之间最多 40 cm
 *   fall_height  6    坠落高度决定要什么地面；超过 250 一律不许
 *   anchoring    5.1  平台高于 60 cm 要固定到墙或地上
 *   tipping      5.2  自己搭的要检查倾覆：总高超过底面短边两倍时提醒
 *   clear_zone   7    模型四周 200 cm 内不能有障碍物
 *   floating     builder  有零件的连通块没有落地
 *   railing      builder  60 cm 以上的站立面外沿，上方没有横管或板
 */
import { connectorsForNode } from "./bom.js";
import { getPanel } from "./catalog.js";

const EPS = 2;              // cm：网格点重合判定
const CORNER_EPS = 6;       // cm：板角落到接头的距离（半个接头加余量）
const GROUND_EPS = 5;       // cm：算作落地
const HEAD_MIN_Y = 55;      // cm：卡头规则从 60 起，留 5 余量
const RAIL_MIN_Y = 60;      // cm：护栏、固定、坠落分级共用的门槛
const LEVEL_MAX = 45;       // cm：层间距 40 加余量
const TIP_RATIO = 2;        // 高度 / 底面短边
const CLEAR_ZONE = 200;     // cm：四周留空

const LEVEL_RANK = { error: 0, warn: 1, info: 2 };

function realTubes(model) {
  return [...model.tubes.values()].filter((t) => !t.arm && !t.link);
}

function dirOf(model, t) {
  const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
  if (!a || !b) return null;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const L = Math.hypot(d[0], d[1], d[2]) || 1;
  return { a, b, len: L, dir: [d[0] / L, d[1] / L, d[2] / L] };
}

const isVertical = (d) => Math.abs(d[1]) > 0.95;
const isHorizontal = (d) => Math.abs(d[1]) < 0.05;

function near(p, q, eps = EPS) {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= eps;
}

function groundOf(model) {
  let min = Infinity;
  for (const n of model.nodes.values()) if (!n.unused && n.y < min) min = n.y;
  return Number.isFinite(min) ? min : 0;
}

/** 四个角的世界坐标；板、布、网都从它们的两根承重管算。 */
function cornersOf(model, p) {
  const c = model.panelCorners(p);
  if (c) return c;
  if (Array.isArray(p.nodes) && p.nodes.length === 4) {
    const pts = p.nodes.map((id) => model.nodes.get(id)).filter(Boolean);
    if (pts.length === 4) return pts.map((n) => [n.x, n.y, n.z]);
  }
  return null;
}

function normalOf(c) {
  const u = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
  const v = [c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}

/** 站立面：水平的板（泳池底不算）。 */
function decksOf(model) {
  const out = [];
  for (const p of model.panels.values()) {
    if (p.poolPart || p.panelId === "pool_floor") continue;
    // 布兜、感官盆占着方框但不是能站的面
    const pdef = getPanel(p.panelId);
    if (pdef && (pdef.feature === "pocket" || pdef.feature === "basin")) continue;
    const c = cornersOf(model, p);
    if (!c) continue;
    if (Math.abs(normalOf(c)[1]) < 0.9) continue;
    out.push({ p, corners: c, y: Math.max(...c.map((q) => q[1])) });
  }
  return out;
}

/** 所有能盖住一个开口的面：板、布、网、袋不算（袋挂在下面）。 */
function coversOf(model) {
  const out = [];
  for (const p of model.panels.values()) {
    const c = cornersOf(model, p);
    if (c) out.push(c);
  }
  for (const x of model.textiles.values()) {
    const c = cornersOf(model, x);
    if (c) out.push(c);
  }
  for (const f of model.fittings.values()) {
    if (f.kind !== "lattice2" || !Array.isArray(f.nodes)) continue;
    const pts = f.nodes.map((id) => model.nodes.get(id)).filter(Boolean);
    if (pts.length === 4) out.push(pts.map((n) => [n.x, n.y, n.z]));
  }
  return out;
}

function nodeNear(model, p, eps = CORNER_EPS) {
  let best = null, bestD = eps;
  for (const n of model.nodes.values()) {
    const d = Math.hypot(n.x - p[0], n.y - p[1], n.z - p[2]);
    if (d <= bestD) { bestD = d; best = n; }
  }
  return best;
}

/** 四个点是否被某个面完整盖住（每个角都落在面的某个角上）。 */
function coveredBy(covers, pts) {
  return covers.some((c) => pts.every((p) => c.some((q) => near(p, q, CORNER_EPS))));
}

// --- 各条规则 -----------------------------------------------------------

function ruleOpenEnd(model, ground, out) {
  // 落在地上的管脚不算：桌腿、柱脚都是这样，官方造型里到处都是。
  // 悬在空中的空管端才会戳到人。
  const nodes = [];
  for (const n of model.nodes.values()) {
    if (n.unused || n.part || n.c45body) continue;
    if (n.y - ground <= GROUND_EPS) continue;
    if (model.degree(n.id) !== 1) continue;
    if (connectorsForNode(model, n).length) continue;
    if (model.hasEndPiece(n)) continue;
    nodes.push(n.id);
  }
  if (nodes.length) out.push({ rule: "open_end", level: "warn", ref: "1.1", params: { n: nodes.length }, ids: { nodes } });
}

function ruleDeckEdges(model, decks, out) {
  const panels = [];
  let edges = 0;
  for (const { p, corners } of decks) {
    let missing = 0;
    for (let i = 0; i < 4; i++) {
      const a = nodeNear(model, corners[i]), b = nodeNear(model, corners[(i + 1) % 4]);
      if (!a || !b || !model.tubeBetween(a.id, b.id)) missing++;
    }
    if (missing) { panels.push(p.id); edges += missing; }
  }
  if (panels.length) out.push({ rule: "deck_edges", level: "warn", ref: "1.3", params: { n: panels.length, edges }, ids: { panels } });
}

function ruleEntrapment(model, ground, covers, out) {
  const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const seen = new Set();
  const tubes = new Set();
  let n = 0;
  for (const t of realTubes(model)) {
    const g = dirOf(model, t);
    if (!g || Math.abs(g.len - 20) > 2) continue;           // 15 管：接头间距 20
    for (const d of AXES) {
      if (Math.abs(d[0] * g.dir[0] + d[1] * g.dir[1] + d[2] * g.dir[2]) > 0.1) continue;
      const a2 = model.findNodeNear(g.a.x + 40 * d[0], g.a.y + 40 * d[1], g.a.z + 40 * d[2]);
      const b2 = model.findNodeNear(g.b.x + 40 * d[0], g.b.y + 40 * d[1], g.b.z + 40 * d[2]);
      if (!a2 || !b2) continue;
      const ta = model.tubeBetween(g.a.id, a2.id), tb = model.tubeBetween(g.b.id, b2.id), tc = model.tubeBetween(a2.id, b2.id);
      if (!ta || !tb || !tc) continue;
      const ids = [g.a.id, g.b.id, b2.id, a2.id];
      const key = [...ids].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const pts = [g.a, g.b, b2, a2].map((q) => [q.x, q.y, q.z]);
      if (Math.min(...pts.map((q) => q[1])) - ground < HEAD_MIN_Y) continue;
      if (coveredBy(covers, pts)) continue;
      n++;
      for (const id of [t.id, ta.id, tb.id, tc.id]) tubes.add(id);
    }
  }
  if (n) out.push({ rule: "entrapment", level: "warn", ref: "2", params: { n }, ids: { tubes: [...tubes] } });
}

function ruleLevelGap(model, decks, ground, out) {
  // 须知 6：可攀爬的结构，层与层的落差最多 40。也就是说每块站立面往下 40 处
  // 要有一级能踩的东西：更低的站立面，或者贴着这块板边上的一根横管。
  const rungs = realTubes(model).map((t) => dirOf(model, t)).filter((g) => g && isHorizontal(g.dir));
  const planDist = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
  const panels = [];
  for (const deck of decks) {
    const h = deck.y - ground;
    if (h <= LEVEL_MAX) continue;
    const want = deck.y - 40;
    const nearDeck = (pt) => deck.corners.some((c) => planDist(c, pt) <= 60);
    const step = decks.some((o) => o !== deck && Math.abs(o.y - want) <= 5 && o.corners.some(nearDeck))
      || rungs.some((g) => Math.abs(g.a.y - want) <= 5 && (nearDeck([g.a.x, g.a.y, g.a.z]) || nearDeck([g.b.x, g.b.y, g.b.z])));
    if (!step) panels.push(deck.p.id);
  }
  if (panels.length) out.push({ rule: "level_gap", level: "warn", ref: "6", params: { n: panels.length }, ids: { panels } });
}

function standingHeight(model, decks, ground) {
  let h = 0;
  for (const d of decks) h = Math.max(h, d.y - ground);
  // 没铺板的框架顶面也能站：有两根以上水平管的接头
  const count = new Map();
  for (const t of realTubes(model)) {
    const g = dirOf(model, t);
    if (!g || !isHorizontal(g.dir)) continue;
    count.set(g.a.id, (count.get(g.a.id) || 0) + 1);
    count.set(g.b.id, (count.get(g.b.id) || 0) + 1);
  }
  for (const [id, c] of count) {
    if (c < 2) continue;
    h = Math.max(h, model.nodes.get(id).y - ground);
  }
  return Math.round(h);
}

function ruleFallHeight(h, indoor, out) {
  if (h <= 0) return;
  const band = h <= 60 ? "any" : h <= 100 ? "soil" : h <= 150 ? "grass" : h <= 250 ? "soft" : "none";
  // 250 以上任何地面都不行；室内地板只顶得住 60 以内，再高要铺减震垫
  const level = band === "none" ? "error" : (indoor && h > 60 ? "warn" : "info");
  out.push({ rule: "fall_height", level, ref: "6", params: { h, band, indoor: !!indoor }, ids: {} });
}

function ruleAnchoring(model, decks, ground, out) {
  const high = decks.filter((d) => d.y - ground > RAIL_MIN_Y);
  if (!high.length) return;
  const h = Math.round(Math.max(...high.map((d) => d.y - ground)));
  out.push({ rule: "anchoring", level: "info", ref: "5.1", params: { h, anchors: 4 }, ids: { panels: high.map((d) => d.p.id) } });
}

function ruleTipping(model, ground, out) {
  let maxY = -Infinity;
  let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
  for (const n of model.nodes.values()) {
    if (n.unused) continue;
    maxY = Math.max(maxY, n.y);
    if (n.y - ground <= GROUND_EPS) {
      gx0 = Math.min(gx0, n.x); gx1 = Math.max(gx1, n.x);
      gz0 = Math.min(gz0, n.z); gz1 = Math.max(gz1, n.z);
    }
  }
  if (!Number.isFinite(maxY)) return;
  const h = maxY - ground;
  const short = Math.max(0, Math.min(gx1 - gx0, gz1 - gz0));
  if (h > TIP_RATIO * short + 1) {
    out.push({ rule: "tipping", level: "warn", ref: "5.2", params: { h: Math.round(h), base: Math.round(short) }, ids: {} });
  }
}

function ruleClearZone(model, room, out) {
  const b = model.bounds ? model.bounds(0) : null;
  if (!b) return;
  const w = Math.round(b.size[0] + 2 * CLEAR_ZONE), d = Math.round(b.size[2] + 2 * CLEAR_ZONE);
  let roomOk = null;
  if (room && room.w > 0 && room.d > 0) roomOk = w <= room.w && d <= room.d;
  out.push({ rule: "clear_zone", level: "info", ref: "7", params: { w, d, roomOk }, ids: {} });
}

function ruleFloating(model, ground, out) {
  // 带轮子或轴承的模型（小车、旋转件）整体离地是正常的
  for (const f of model.fittings.values()) {
    if (["multi-wheel2", "floating-wheel2", "casters2", "bearing2"].includes(f.kind)) return;
  }
  for (const n of model.nodes.values()) if (n.bearingOn || n.clampOn) return;
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };
  for (const n of model.nodes.values()) if (!n.unused && !adj.has(n.id)) adj.set(n.id, new Set());
  for (const t of model.tubes.values()) link(t.a, t.b);
  for (const n of model.nodes.values()) {
    if (!n.clampOn) continue;
    const t = model.tubes.get(n.clampOn.tubeId);
    if (t) { link(n.id, t.a); link(n.id, t.b); }
  }
  // 官方文件里的斜梁、屋脊常常只靠 45° 接头的几何贴着主体，没有连线：
  // 挨得很近（15 cm 内）的接头算连在一起。
  const list = [...model.nodes.values()].filter((nd) => !nd.unused);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Math.abs(a.y - b.y) > 15) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 15) link(a.id, b.id);
    }
  }
  const seen = new Set();
  const nodes = [];
  let n = 0;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      comp.push(id);
      for (const o of adj.get(id) || []) if (!seen.has(o)) { seen.add(o); stack.push(o); }
    }
    if (comp.length < 2) continue;
    let minY = Infinity;
    for (const id of comp) { const nd = model.nodes.get(id); if (nd) minY = Math.min(minY, nd.y); }
    if (minY - ground > GROUND_EPS) { n++; nodes.push(...comp); }
  }
  if (n) out.push({ rule: "floating", level: "error", ref: "builder", params: { n }, ids: { nodes } });
}

function ruleRailing(model, decks, ground, covers, out) {
  const rails = realTubes(model).map((t) => ({ t, g: dirOf(model, t) })).filter((r) => r.g && isHorizontal(r.g.dir));
  const hooks = [...model.slides.values()].map((s) => s.hook).filter((h) => Array.isArray(h) && h.length === 3);
  const planNear = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]) <= CORNER_EPS;
  const panels = [];
  let edges = 0;
  let maxH = 0;
  for (const deck of decks) {
    if (deck.y - ground < RAIL_MIN_Y) continue;
    let open = 0;
    for (let i = 0; i < 4; i++) {
      const A = deck.corners[i], B = deck.corners[(i + 1) % 4];
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      // 相邻的站立面：同层拼接，或 45 以内的台阶
      const neighbour = decks.some((o) => o !== deck && o.y <= deck.y + EPS && deck.y - o.y <= LEVEL_MAX
        && o.corners.some((q) => planNear(q, A)) && o.corners.some((q) => planNear(q, B)));
      if (neighbour) continue;
      // 滑梯从这条边出去
      if (hooks.some((h) => Math.hypot(h[0] - mid[0], h[2] - mid[2]) <= 25 && Math.abs(h[1] - deck.y) <= 15)) continue;
      // 护栏：这条边正上方 15–85 cm 内的横管
      const railed = rails.some(({ g }) => {
        const pa = [g.a.x, g.a.y, g.a.z], pb = [g.b.x, g.b.y, g.b.z];
        const above = g.a.y - deck.y;
        if (above < 15 || above > 85) return false;
        return (planNear(pa, A) && planNear(pb, B)) || (planNear(pa, B) && planNear(pb, A));
      });
      if (railed) continue;
      // 或者一块立着的板、布、网挡在这条边上
      const walled = covers.some((c) => c.some((q) => planNear(q, A)) && c.some((q) => planNear(q, B))
        && c.some((q) => q[1] > deck.y + 15));
      if (walled) continue;
      open++;
    }
    if (open) { panels.push(deck.p.id); edges += open; maxH = Math.max(maxH, deck.y - ground); }
  }
  // 100 以上的站立面（须知 6：泥土地都接不住）没护栏算提醒，60–100 算说明
  if (panels.length) out.push({ rule: "railing", level: maxH >= 100 ? "warn" : "info", ref: "builder", params: { n: panels.length, edges, h: Math.round(maxH) }, ids: { panels } });
}

/**
 * 全部规则跑一遍。opts.room = { w, d }（厘米，可选，填了就和无障碍区比）。
 * 返回 { findings, height }：findings 按 错误 → 提醒 → 说明 排；height 是最高站立面（cm）。
 */
export function computeSafety(model, opts = {}) {
  const out = [];
  if (!model || !model.nodes.size) return { findings: out, height: 0 };
  const ground = groundOf(model);
  const decks = decksOf(model);
  const covers = coversOf(model);
  const height = standingHeight(model, decks, ground);
  ruleOpenEnd(model, ground, out);
  ruleDeckEdges(model, decks, out);
  ruleEntrapment(model, ground, covers, out);
  ruleLevelGap(model, decks, ground, out);
  ruleFallHeight(height, opts.indoor, out);
  ruleAnchoring(model, decks, ground, out);
  ruleTipping(model, ground, out);
  ruleClearZone(model, opts.room, out);
  ruleFloating(model, ground, out);
  ruleRailing(model, decks, ground, covers, out);
  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return { findings: out, height };
}

/**
 * 最大跨度（cm）：沿同一条直线连着的水平管上，相邻两个支撑点之间最远的距离。
 * 支撑点是落地的接头，或者有管往下接的接头。只挂在别的横梁上、自己没有支撑点的
 * 那一段不算跨度。
 */
function maxSpanOf(model, ground) {
  const horiz = realTubes(model).map((t) => ({ t, g: dirOf(model, t) })).filter((r) => r.g && isHorizontal(r.g.dir));
  const supported = (n) => {
    if (n.y - ground <= GROUND_EPS) return true;
    for (const id of model.incidentTubeIds(n.id)) {
      const t = model.tubes.get(id);
      if (!t || t.arm || t.link) continue;
      const o = model.nodes.get(t.a === n.id ? t.b : t.a);
      if (o && o.y < n.y - EPS) return true;
    }
    return false;
  };
  // 按方向分组，每组里用并查集把首尾相接的管连成一条直线
  const byLine = new Map();
  for (const { g } of horiz) {
    const d = g.dir[0] < -1e-6 || (Math.abs(g.dir[0]) < 1e-6 && g.dir[2] < 0) ? g.dir.map((v) => -v) : g.dir;
    const key = d.map((v) => Math.round(v * 100)).join(",");
    if (!byLine.has(key)) byLine.set(key, { dir: d, pairs: [] });
    byLine.get(key).pairs.push([g.a, g.b]);
  }
  let best = 0;
  for (const { dir, pairs } of byLine.values()) {
    const parent = new Map();
    const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
    for (const [a, b] of pairs) {
      if (!parent.has(a.id)) parent.set(a.id, a.id);
      if (!parent.has(b.id)) parent.set(b.id, b.id);
      parent.set(find(a.id), find(b.id));
    }
    const runs = new Map();
    for (const [a, b] of pairs) {
      const r = find(a.id);
      if (!runs.has(r)) runs.set(r, new Map());
      runs.get(r).set(a.id, a).set(b.id, b);
    }
    for (const nodes of runs.values()) {
      const along = [...nodes.values()].filter(supported)
        .map((n) => n.x * dir[0] + n.y * dir[1] + n.z * dir[2]).sort((p, q) => p - q);
      for (let i = 1; i < along.length; i++) best = Math.max(best, along[i] - along[i - 1]);
    }
  }
  return Math.round(best);
}

/**
 * 交付页的客观量：最高站立面离地高度（cm）、最大跨度（cm）、有没有围挡、占地面积（m²）。
 * 围挡：有 60 cm 以上的站立面，而且它们的外沿都有护栏（横管或者立着的板、布、网）。
 * 只陈述引擎算出来的数，不做安全背书。
 */
export function computeMetrics(model) {
  if (!model || !model.nodes.size) return { maxDeckHeight: 0, maxSpan: 0, hasGuard: false, footprint: 0 };
  const ground = groundOf(model);
  const decks = decksOf(model);
  const covers = coversOf(model);
  const out = [];
  ruleRailing(model, decks, ground, covers, out);
  const high = decks.some((d) => d.y - ground >= RAIL_MIN_Y);
  const b = model.bounds(2.5);
  return {
    maxDeckHeight: standingHeight(model, decks, ground),
    maxSpan: maxSpanOf(model, ground),
    hasGuard: high && !out.length,
    footprint: b ? Math.round(b.size[0] * b.size[2] / 100) / 100 : 0,
  };
}

export const SAFETY_RULE_IDS = [
  "open_end", "deck_edges", "entrapment", "level_gap", "fall_height",
  "anchoring", "tipping", "clear_zone", "floating", "railing",
];
