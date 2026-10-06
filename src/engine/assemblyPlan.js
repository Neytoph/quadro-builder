import {normalizedAssemblyQuaternion} from './assemblyAccessoryMethods.js';
import { computeBOM, connectorsForNode, resolveNodeConnection, reinforcementRuns, textileRow } from './bom.js';
import { reinforcementPart } from './catalog.js';
import { geometry } from './catalog.js';
import { checkAssemblyPath, beginAssemblyCollisionPass } from './assemblyCollision.js';
import { assemblyMeshes } from './assemblyNativeMesh.js';
import { scheduleAssemblyAccessories, addAssemblyOperations } from './assemblyOperations.js';
import { consolidateLayerSteps } from './assemblyLayerSteps.js';
import { xAxisOf, yAxisOf } from './util.js';
import { C45_ARM_LEN, C45_SLEEVE_LEN } from './config.js';
import { getLang } from './i18n.js';
import { isOriginalComponent, componentInstallCopy, componentPartId } from './accessoryInfo.js';

const GROUPS = ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'screws', 'reinforcements'];
const MAPS = { nodeIds: 'nodes', tubeIds: 'tubes', panelIds: 'panels', textileIds: 'textiles', slideIds: 'slides', fittingIds: 'fittings', clampIds: 'clamps' };
const EPS = 0.6;
const emptyParts = () => Object.fromEntries(GROUPS.map(k => [k, []]));
const values = (model, name) => [...(model[name]?.values() || [])];
const point = n => [n.x, n.y, n.z];
const norm = d => { const l = Math.hypot(...d) || 1; return d.map(v => v / l); };
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const copy = (zh, en, de) => getLang() === 'zh' ? zh : getLang() === 'en' ? en : de;
const coordOf = order => n => (n?.[order[0]] || 0) * (order[1] === '-' ? -1 : 1);
const idsOf = r => Object.keys(MAPS).flatMap(k => r[k] || []);
const rowKey = (group, row) => row.key ?? (group === 'connectors' ? row.type : `${row.id || row.panelId || row.tubeId || row.kind}|${row.color || ''}`);

function insertionObstruction(model, region, installed, translation, destination = [0, 0, 0], allowSharedSeams = true) {
  const keys = Object.keys(MAPS);
  const movingIds = [...new Set(keys.flatMap(k => region[k] || []))];
  const installedIds = [...new Set(installed.flatMap(r => keys.flatMap(k => r[k] || [])))];
  return checkAssemblyPath(model, movingIds, installedIds, translation, destination, { allowMating: allowSharedSeams });
}

function components(items, neighbors) {
  const remaining = new Set(items), out = [];
  for (const start of items) {
    if (!remaining.delete(start)) continue;
    const group = [start];
    for (let i = 0; i < group.length; i++) for (const next of neighbors(group[i])) {
      if (remaining.delete(next)) group.push(next);
    }
    out.push(group);
  }
  return out;
}

/** 真实拓扑分区：尖顶、夹具坡道与滑梯链先识别，主体按相连框架分区。 */
function automaticRegions(model) {
  const tubes = values(model, 'tubes'), taken = new Set(), regions = [];
  const byNode = new Map();
  for (const tube of tubes) for (const id of [tube.a, tube.b]) {
    if (!byNode.has(id)) byNode.set(id, []);
    byNode.get(id).push(tube);
  }
  const make = (kind, memberTubes = [], memberNodes = []) => {
    const region = { id: `${kind}-${regions.length + 1}`, kind, name: '', tubeIds: memberTubes.map(t => t.id), nodeIds: [...new Set([...memberNodes, ...memberTubes.flatMap(t => [t.a, t.b])])], ownedNodeIds: [], panelIds: [], textileIds: [], slideIds: [], fittingIds: [], clampIds: [], partIds: [] };
    regions.push(region);
    for (const tube of memberTubes) taken.add(tube.id);
    return region;
  };
  const slope = t => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    if (!a || !b || t.arm || t.link || t.bow) return false;
    const d = norm([b.x - a.x, b.y - a.y, b.z - a.z]);
    return Math.abs(d[1]) > 0.2 && Math.abs(d[1]) < 0.95;
  };
  const peakTubes = new Set(), peakNodes = new Set();
  for (const node of model.nodes.values()) {
    const down = (byNode.get(node.id) || []).filter(t => slope(t) && model.nodes.get(t.a === node.id ? t.b : t.a).y < node.y - EPS);
    if (down.length !== 2) continue;
    const dirs = down.map(t => { const other = model.nodes.get(t.a === node.id ? t.b : t.a); return norm([other.x - node.x, other.y - node.y, other.z - node.z]); });
    if (!dirs.every(d => Math.abs(Math.abs(d[1]) - Math.SQRT1_2) < 0.08)) continue;
    if (dirs[0][0] * dirs[1][0] + dirs[0][2] * dirs[1][2] > -0.3) continue;
    if (Math.abs(dirs[0].reduce((s, v, i) => s + v * dirs[1][i], 0)) > 0.18) continue;
    peakNodes.add(node.id);
    for (const t of down) peakTubes.add(t.id);
  }
  // 两个尖顶通过脊管相连时，完整三角模块一起预装。
  for (const t of tubes) if (peakNodes.has(t.a) && peakNodes.has(t.b)) peakTubes.add(t.id);
  const peakGroups = components([...peakTubes], id => {
    const t = model.tubes.get(id);
    return [t.a, t.b].flatMap(n => (byNode.get(n) || []).filter(o => peakTubes.has(o.id)).map(o => o.id));
  });
  for (const group of peakGroups) {
    const members = group.map(id => model.tubes.get(id));
    const bodies = new Set(members.flatMap(t => [t.a, t.b]).filter(id => model.nodes.get(id)?.c45body));
    for (const t of tubes) if (t.arm && (bodies.has(t.a) || bodies.has(t.b))) members.push(t);
    make('roof', members);
  }
  // 将屋檐框与 C45 基座纳入屋顶模块，插接边界落在下方立柱上，获得共向的竖直安装口。
  for (const roof of regions.filter(r => r.kind === 'roof')) {
    const bases = new Set(roof.tubeIds.flatMap(id => { const t = model.tubes.get(id); return t.arm ? [t.a, t.b].filter(n => !model.nodes.get(n)?.c45body) : []; }));
    for (const id of roof.nodeIds) if (!model.nodes.get(id)?.c45body && !peakNodes.has(id)) bases.add(id);
    const pending = [...bases];
    for (let i = 0; i < pending.length; i++) for (const t of byNode.get(pending[i]) || []) {
      if (t.arm || t.link || t.bow || taken.has(t.id)) continue;
      const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
      if (Math.abs(a.y - b.y) > EPS) continue;
      roof.tubeIds.push(t.id); taken.add(t.id);
      for (const id of [t.a, t.b]) if (!bases.has(id)) { bases.add(id); pending.push(id); }
    }
    roof.nodeIds = [...new Set([...roof.nodeIds, ...bases])];
  }
  // 两个尖顶共享同一屋檐框时归为一个屋顶模块。
  const roofs = regions.filter(r => r.kind === 'roof');
  for (let i = 0; i < roofs.length; i++) for (let j = i + 1; j < roofs.length; j++) if (roofs[j].tubeIds.length && roofs[i].nodeIds.some(id => roofs[j].nodeIds.includes(id))) {
    for (const key of ['tubeIds', 'nodeIds']) roofs[i][key] = [...new Set([...roofs[i][key], ...roofs[j][key]])];
    roofs[j].tubeIds = []; roofs[j].nodeIds = [];
  }
  for (let i = regions.length - 1; i >= 0; i--) if (regions[i].kind === 'roof' && !regions[i].tubeIds.length) regions.splice(i, 1);
  // 倾斜屋檐短支架与屋顶连成一体时继续合并，安装边界下移到主体立柱。
  for (const roof of regions.filter(r => r.kind === 'roof')) {
    const own = new Set(roof.nodeIds), pending = [...own];
    for (let i = 0; i < pending.length; i++) for (const t of byNode.get(pending[i]) || []) {
      if (taken.has(t.id) || t.bow || t.link) continue;
      const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
      const angled = t.arm || (Math.abs(a.y - b.y) > EPS && Math.hypot(a.x - b.x, a.z - b.z) > EPS);
      const horizontal = Math.abs(a.y - b.y) <= EPS;
      if (!angled && !horizontal) continue;
      roof.tubeIds.push(t.id); taken.add(t.id);
      for (const id of [t.a, t.b]) if (!own.has(id)) { own.add(id); pending.push(id); }
    }
    roof.nodeIds = [...own];
  }
  const expandedRoofs = regions.filter(r => r.kind === 'roof');
  for (const group of components(expandedRoofs.map(r => r.id), id => {
    const r = expandedRoofs.find(r => r.id === id);
    return expandedRoofs.filter(other => other.id !== id && r.nodeIds.some(n => other.nodeIds.includes(n))).map(r => r.id);
  })) {
    const first = expandedRoofs.find(r => r.id === group[0]);
    for (const id of group.slice(1)) {
      const other = expandedRoofs.find(r => r.id === id);
      for (const key of ['tubeIds', 'nodeIds']) first[key] = [...new Set([...first[key], ...other[key]])];
      regions.splice(regions.indexOf(other), 1);
    }
  }
  // 双管夹具的活动支架是一个真实模块；夹具本身只归属一次。
  const handledClamps = new Set();
  for (const clamp of values(model, 'clamps')) {
    if (handledClamps.has(clamp.id)) continue;
    const cohort = model.clampCohort?.(clamp.id);
    if (!cohort?.tubes?.size) continue;
    const memberTubes = [...cohort.tubes].map(id => model.tubes.get(id)).filter(t => t && !taken.has(t.id));
    if (!memberTubes.length) continue;
    const region = make('ramp', memberTubes);
    region.clampIds = [...cohort.clamps];
    for (const id of cohort.clamps) handledClamps.add(id);
  }
  const angled = tubes.filter(t => !taken.has(t.id) && slope(t));
  const rotated = new Set(angled.flatMap(t => [t.a, t.b]).filter(id => model.nodes.get(id)?.quat));
  const rampTubes = new Set(angled.map(t => t.id));
  for (const t of tubes) if (!taken.has(t.id) && rotated.has(t.a) && rotated.has(t.b)) rampTubes.add(t.id);
  for (const group of components([...rampTubes], id => {
    const t = model.tubes.get(id);
    return [t.a, t.b].flatMap(n => (byNode.get(n) || []).filter(o => rampTubes.has(o.id)).map(o => o.id));
  })) make('ramp', group.map(id => model.tubes.get(id)));

  const ordinary = tubes.filter(t => !taken.has(t.id));
  const columns = new Map(), columnOf = new Map();
  for (const id of new Set(ordinary.flatMap(t => [t.a, t.b]))) {
    const n = model.nodes.get(id), key = `${Math.round(n.x / EPS)},${Math.round(n.z / EPS)}`;
    if (!columns.has(key)) columns.set(key, { key, nodeIds: [], min: Infinity, max: -Infinity, neighbors: new Set() });
    const col = columns.get(key); col.nodeIds.push(id); col.min = Math.min(col.min, n.y); col.max = Math.max(col.max, n.y); columnOf.set(id, key);
  }
  for (const t of ordinary) {
    const a = columnOf.get(t.a), b = columnOf.get(t.b);
    if (a !== b) { columns.get(a).neighbors.add(b); columns.get(b).neighbors.add(a); }
  }
  // 中间横梁没有独立立柱时归入相连竖向柱组；以 40 cm 标准层高合并同一主体。
  for (const col of columns.values()) if (col.max - col.min <= EPS) {
    const support = [...col.neighbors].map(key => columns.get(key)).filter(c => c.max - c.min > EPS && c.min <= col.min + EPS && c.max >= col.max - EPS).sort((a, b) => (b.max - b.min) - (a.max - a.min))[0];
    if (support) { col.min = support.min; col.max = support.max; }
  }
  const sameSpan = (a, b) => Math.floor((a.min + EPS) / 40) === Math.floor((b.min + EPS) / 40) && Math.floor((a.max + EPS) / 40) === Math.floor((b.max + EPS) / 40);
  const bodies = [], colRegion = new Map();
  for (const group of components([...columns.keys()], key => [...columns.get(key).neighbors].filter(next => sameSpan(columns.get(key), columns.get(next))))) {
    const body = make('body', [], group.flatMap(key => columns.get(key).nodeIds));
    body.baseY = Math.min(...group.map(key => columns.get(key).min)); body.topY = Math.max(...group.map(key => columns.get(key).max));
    bodies.push(body); for (const key of group) colRegion.set(key, body);
  }
  for (const t of ordinary) {
    const a = colRegion.get(columnOf.get(t.a)), b = colRegion.get(columnOf.get(t.b));
    const region = a === b ? a : [a, b].sort((a, b) => a.baseY - b.baseY || b.topY - a.topY || a.id.localeCompare(b.id))[0];
    region.tubeIds.push(t.id); region.nodeIds = [...new Set([...region.nodeIds, t.a, t.b])]; taken.add(t.id);
  }
  for (const n of model.nodes.values()) if (!regions.some(r => r.nodeIds.includes(n.id))) {
    const nearest = bodies.map(r => ({ r, d: Math.min(...r.nodeIds.map(id => distance(point(n), point(model.nodes.get(id))))) })).sort((a, b) => a.d - b.d)[0]?.r;
    if (nearest) nearest.nodeIds.push(n.id); else make('body', [], [n.id]);
  }
  const regionHeight = r => Math.min(...r.nodeIds.map(id => model.nodes.get(id).y));
  regions.sort((a, b) => (a.kind === 'body' ? 0 : 1) - (b.kind === 'body' ? 0 : 1) || regionHeight(a) - regionHeight(b) || (b.topY || 0) - (a.topY || 0) || a.id.localeCompare(b.id));
  // 节点可作为多个区域的接口，实体连接件归属最早建立的区域。
  const ownedNodes = new Set();
  for (const region of regions) {
    region.ownedNodeIds = region.nodeIds.filter(id => !ownedNodes.has(id) && (region.kind === 'roof' || !regions.some(r => r.kind === 'roof' && r.nodeIds.includes(id))));
    for (const id of region.ownedNodeIds) ownedNodes.add(id);
  }
  // 连续主体没有共同插接方向时合并，以免把连续框架伪装成可整体搬动的模块。
  for (let pass = 0; pass < regions.length; pass++) {
  let mergedBody = false;
  for (const target of [...regions].filter(r => r.kind === 'body')) {
    if (!regions.includes(target)) continue;
    const earlier = regions.slice(0, regions.indexOf(target)).filter(r => r.kind === 'body');
    const shared = earlier.flatMap(source => source.nodeIds.filter(id => target.nodeIds.includes(id)).map(id => ({ source, id })));
    const dirs = shared.flatMap(({ source, id }) => {
      const n = model.nodes.get(id), ownsNode = target.ownedNodeIds.includes(id);
      const tubes = (ownsNode ? source : target).tubeIds.map(id => model.tubes.get(id)).filter(t => t.a === id || t.b === id);
      return tubes.map(t => { const other = model.nodes.get(t.a === id ? t.b : t.a); return norm(model._tubeDirAt(t, n, other)).map(v => ownsNode ? v : -v); });
    });
    const common = dirs.length && dirs.every(d => d.reduce((s, v, i) => s + v * dirs[0][i], 0) > 0.97);
    if (!shared.length) continue;
    if (common) {
      const width = Math.max(...target.nodeIds.map(id => model.nodes.get(id).x)) - Math.min(...target.nodeIds.map(id => model.nodes.get(id).x));
      const translation = dirs[0].map(v => -v * Math.max(45, width * 0.4));
      const belowGround = target.ownedNodeIds.some(id => model.nodes.get(id).y + translation[1] < -EPS);
      if (!belowGround && !insertionObstruction(model, target, earlier, translation)) continue;
    }
    const source = shared[0].source;
    for (const key of [...Object.keys(MAPS), 'ownedNodeIds']) source[key] = [...new Set([...source[key], ...target[key]])];
    source.baseY = Math.min(source.baseY ?? Infinity, target.baseY ?? Infinity); source.topY = Math.max(source.topY ?? -Infinity, target.topY ?? -Infinity);
    source.continuous = true; regions.splice(regions.indexOf(target), 1); mergedBody = true;
  }
  if (!mergedBody) break;
  }
  const tubeRegion = new Map(regions.flatMap(r => r.tubeIds.map(id => [id, r])));
  const nearestRegion = p => {
    const support = p.supportTubes || [p.tube, p.a, p.b];
    const supporting = support.map(id => tubeRegion.get(id)).filter(Boolean);
    if (supporting.length) return supporting.sort((a, b) => regions.indexOf(b) - regions.indexOf(a))[0];
    let nearest = regions[0], d = Infinity;
    for (const r of regions) for (const id of r.nodeIds) {
      const nd = distance(point(model.nodes.get(id)), point(p));
      if (nd < d) { d = nd; nearest = r; }
    }
    return nearest;
  };
  for (const [key, name] of Object.entries(MAPS)) {
    if (['nodes', 'tubes', 'slides'].includes(name)) continue;
    for (const p of values(model, name)) {
      if (regions.some(r => r[key].includes(p.id))) continue;
      const region = nearestRegion(p) || make('body');
      region[key].push(p.id);
    }
  }
  const slides = values(model, 'slides'), next = new Map(), parent = new Set();
  for (const s of slides) {
    const exit = model.slideExit?.(s);
    if (!exit) continue;
    const near = slides.filter(o => o.id !== s.id && !parent.has(o.id)).map(o => ({ o, d: distance(point(o), exit.pos) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 12) { next.set(s.id, near.o); parent.add(near.o.id); }
  }
  const seen = new Set();
  const heads = [...slides.filter(s => !parent.has(s.id)), ...slides];
  for (const head of heads) {
    if (seen.has(head.id)) continue;
    const region = make('slide');
    region.accessoryType = head.kind === 'roof2' ? 'roof-cover' : 'slide';
    for (let cur = head; cur && !seen.has(cur.id); cur = next.get(cur.id)) { region.slideIds.push(cur.id); seen.add(cur.id); }
    const anchor = model.slideEntry?.(head) || head;
    const support = nearestRegion(anchor);
    region.supportRegionId = support?.id;
    region.anchor = point(anchor);
  }
  // A connector with no physical body tube is part of the sole adjoining
  // ramp frame. Consuming it as an isolated body would close both tube ends
  // before that frame can be preassembled.
  for(const placeholder of regions.filter(region=>region.kind==='body'))for(const nodeId of [...(placeholder.ownedNodeIds||[])]){
    if(placeholder.tubeIds.some(id=>{const t=model.tubes.get(id);return !t.arm&&!t.link&&(t.a===nodeId||t.b===nodeId);} ))continue;
    const adjoining=regions.filter(region=>region!==placeholder&&region.tubeIds.some(id=>{const tube=model.tubes.get(id);return !tube.arm&&!tube.link&&(tube.a===nodeId||tube.b===nodeId);}));
    if(adjoining.length===1&&adjoining[0].kind==='ramp'){
      const frame=adjoining[0];placeholder.ownedNodeIds=placeholder.ownedNodeIds.filter(id=>id!==nodeId);if(!placeholder.tubeIds.some(id=>{const t=model.tubes.get(id);return t.a===nodeId||t.b===nodeId;}))placeholder.nodeIds=placeholder.nodeIds.filter(id=>id!==nodeId);frame.ownedNodeIds=[...new Set([...frame.ownedNodeIds,nodeId])];frame.nodeIds=[...new Set([...frame.nodeIds,nodeId])];
    }
  }
  const counters = {};
  for (const r of regions) {
    r.supportRank = regions.indexOf(r);
    counters[r.kind] = (counters[r.kind] || 0) + 1;
    const index = counters[r.kind];
    r.name = r.kind === 'roof' ? copy(`尖顶 ${index}`, `Roof ${index}`, `Dach ${index}`) : r.kind === 'ramp' ? copy(`坡道 ${index}`, `Ramp ${index}`, `Rampe ${index}`) : r.kind === 'slide' ? copy(`滑梯链 ${index}`, `Slide chain ${index}`, `Rutschenkette ${index}`) : copy(`主体区域 ${index}`, `Body region ${index}`, `Hauptbereich ${index}`);
    if (r.accessoryType === 'roof-cover') r.name = copy(`屋顶配件 ${index}`, `Roof accessory ${index}`, `Dachaufsatz ${index}`);
    r.partIds = [...r.ownedNodeIds || [], ...Object.keys(MAPS).filter(k => k !== 'nodeIds').flatMap(k => r[k])];
  }
  return regions.filter(r => r.partIds.length);
}

function applyConfig(model, automatic, config, diagnostics) {
  if (!config || (!config.regions && !config.order)) return automatic;
  const error = (code, message, partIds = []) => diagnostics.push({ code, severity: 'error', message, partIds, nodeIds: [] });
  if (config.version !== 1 || (config.regions && !Array.isArray(config.regions)) || (config.order && !Array.isArray(config.order))) {
    error('INVALID_ASSEMBLY_CONFIG', '装配区域配置格式无效。');
    return automatic;
  }
  const source = new Map(automatic.flatMap(r => r.partIds.map(id => [id, r])));
  const all = new Map(Object.values(MAPS).flatMap(name => values(model, name).map(p => [p.id, name])));
  const claimed = new Set(), regionIds = new Set(), out = [];
  for (const entry of config.regions || []) {
    if (!entry?.id || regionIds.has(entry.id) || !Array.isArray(entry.partIds) || !entry.partIds.length) { error('INVALID_REGION', '区域编号重复或区域没有部件。'); continue; }
    regionIds.add(entry.id);
    const r = { id: entry.id, name: entry.name || entry.id, kind: 'custom', partIds: [], ...Object.fromEntries(Object.keys(MAPS).map(k => [k, []])), ownedNodeIds: [] };
    const kinds = new Set();
    for (const id of entry.partIds) {
      if (!all.has(id)) { error('UNKNOWN_REGION_PART', `区域引用了不存在的部件 ${id}。`, [id]); continue; }
      if (claimed.has(id)) { error('DUPLICATE_REGION_PART', `部件 ${id} 重复属于多个区域。`, [id]); continue; }
      claimed.add(id); r.partIds.push(id);
      const name = all.get(id), key = Object.keys(MAPS).find(k => MAPS[k] === name);
      r[key].push(id);
      if (name === 'nodes') r.ownedNodeIds.push(id);
      if (source.has(id)) kinds.add(source.get(id).kind);
    }
    if (kinds.size === 1) r.kind = [...kinds][0];
    r.supportRank = Math.min(...r.partIds.map(id => source.get(id)?.supportRank ?? Infinity));
    for (const id of r.tubeIds) { const t = model.tubes.get(id); r.nodeIds.push(t.a, t.b); }
    r.nodeIds = [...new Set(r.nodeIds)];
    // Persisted manual regions may already own an accessory moved to an
    // earlier support layer. That does not change the physical frame kind.
    // Inherit anchors only when its stable ID and actual tube boundary match.
    const template=automatic.find(auto=>auto.id===r.id&&auto.tubeIds.length===r.tubeIds.length&&auto.tubeIds.every(id=>r.tubeIds.includes(id))&&(auto.tubeIds.length>0||(auto.slideIds.length>0&&auto.slideIds.length===r.slideIds.length&&auto.slideIds.every(id=>r.slideIds.includes(id)))));
    if(template)Object.assign(r,{...template,...r,kind:template.kind});
    if (r.partIds.length) out.push(r);
  }
  // 未编辑的部件继续使用自动区域，保存配置无需复制所有未变化部件。
  for (const auto of automatic) {
    const remaining = auto.partIds.filter(id => !claimed.has(id));
    if (!remaining.length) continue;
    if (regionIds.has(auto.id)) { error('INCOMPLETE_REGION', '自定义区域覆盖同名区域时遗漏了部件。', remaining); continue; }
    const r = { ...auto, partIds: remaining, ownedNodeIds: auto.ownedNodeIds.filter(id => !claimed.has(id)) };
    for (const k of Object.keys(MAPS)) if (k !== 'nodeIds') r[k] = auto[k].filter(id => !claimed.has(id));
    r.nodeIds = [...new Set([...r.ownedNodeIds, ...r.tubeIds.flatMap(id => { const t = model.tubes.get(id); return [t.a, t.b]; })])];
    out.push(r);
  }
  if (config.order) {
    if (new Set(config.order).size !== config.order.length || config.order.some(id => !out.some(r => r.id === id))) error('INVALID_REGION_ORDER', '区域顺序含重复或不存在的区域编号。');
    const rank = id => { const i = config.order.indexOf(id); return i < 0 ? config.order.length + out.findIndex(r => r.id === id) : i; };
    out.sort((a, b) => rank(a.id) - rank(b.id));
  }
  return out;
}

function allocateBOM(model, bom, steps, owner, diagnostics) {
  const ledger = { instances: [], rows: [], conserved: true, totals: {} };
  const allocations = new Map();
  const add = (group, key, partIds, count = 1) => {
    const list = allocations.get(`${group}:${key}`) || [];
    list.push({ partIds, count }); allocations.set(`${group}:${key}`, list);
  };
  for (const t of model.tubes.values()) if (!t.arm && !t.link) add('tubes', `${t.tubeId}|${t.color}`, [t.id]);
  for (const n of model.nodes.values()) for (const type of connectorsForNode(model, n)) add('connectors', type, [n.id]);
  for (const c of values(model, 'clamps')) add('connectors', c.connectorId || 'double_tube', [c.id]);
  for (const p of model.panels.values()) {
    // 原始 BOM 的颜色字段已完成原创套装颜色规范化。
    const subset = Object.assign(Object.create(Object.getPrototypeOf(model)), model, { panels: new Map([[p.id, p]]), fittings: new Map(), textiles: new Map(), slides: new Map() });
    const one = computeBOM(subset);
    for (const group of ['panels', 'fittings']) for (const row of one[group]) add(group, rowKey(group, row), [p.id], row.count);
  }
  for (const f of values(model, 'fittings')) {
    const subset = Object.assign(Object.create(Object.getPrototypeOf(model)), model, { panels: new Map(), fittings: new Map([[f.id, f]]), textiles: new Map(), slides: new Map() });
    for (const row of computeBOM(subset).fittings) add('fittings', rowKey('fittings', row), [f.id], row.count);
  }
  for (const tx of values(model, 'textiles')) add('textiles', textileRow(model, tx).key, [tx.id]);
  for (const sl of values(model, 'slides')) add('slides', sl.kind, [sl.id]);
  for (const row of bom.screws) for (const a of row.allocations || []) add('screws', rowKey('screws', row), [a.partId], a.count);
  const reinforcement = reinforcementPart();
  if (reinforcement) for (const run of reinforcementRuns(model)) add('reinforcements', reinforcement.id, run.tubeIds, Math.max(1, Math.round(run.length / (reinforcement.length_cm || 80))));
  for (const group of GROUPS) for (const row of bom[group]) {
    const key = rowKey(group, row), sources = allocations.get(`${group}:${key}`) || [];
    const actual = sources.reduce((sum, a) => sum + a.count, 0);
    if (actual !== row.count) {
      diagnostics.push({ code: 'BOM_UNASSIGNED', severity: 'error', message: `物料 ${row.name} 的归属数量 ${actual} 与总表 ${row.count} 不一致。`, nodeIds: [], partIds: sources.flatMap(a => a.partIds) }); ledger.conserved = false;
    }
    let assigned = 0;
    for (let i = 0; i < sources.length; i++) {
      const allocation = sources[i], indexes = allocation.partIds.map(id => owner.get(id)).filter(i => i !== undefined);
      const index = Math.max(-1, ...indexes), step = steps[index];
      if (!step) { diagnostics.push({ code: 'PART_UNASSIGNED', severity: 'error', message: `部件 ${allocation.partIds.join(', ')} 没有装配步骤。`, nodeIds: [], partIds: allocation.partIds }); ledger.conserved = false; continue; }
      const existing = step.parts[group].find(r => rowKey(group, r) === key);
      if (existing) { existing.count += allocation.count; existing.instanceIds.push(...allocation.partIds); existing.subtotal = Math.round(existing.price * existing.count * 100) / 100; }
      else step.parts[group].push({ ...row, allocations: undefined, count: allocation.count, instanceIds: [...allocation.partIds], subtotal: Math.round((row.price || 0) * allocation.count * 100) / 100 });
      ledger.instances.push({ id: `${group}:${key}:${i + 1}`, group, key, count: allocation.count, partIds: allocation.partIds, stepId: step.id, regionId: step.regionId });
      assigned += allocation.count;
    }
    ledger.rows.push({ group, key, expected: row.count, assigned, conserved: assigned === row.count });
    ledger.totals[group] = (ledger.totals[group] || 0) + assigned;
  }
  return ledger;
}

export function computeAssemblyPlan(model, config = model.assemblyConfig || {}, order = 'y+', internal = {}) {
  if (!assemblyMeshes()) throw new Error('装配网格还没加载');
  beginAssemblyCollisionPass(model);
  const deferredAccessories=internal.deferredAccessories||[],deferredIds=new Set(deferredAccessories.map(item=>item.partId));
  const diagnostics = [], coord = n => n.y;
  for (const n of model.nodes.values()) diagnostics.push(...resolveNodeConnection(model, n).diagnostics);
  for (const tube of model.tubes.values()) if (!model.nodes.has(tube.a) || !model.nodes.has(tube.b)) diagnostics.push({ code: 'MISSING_TUBE_ENDPOINT', severity: 'error', message: '管件端点不存在。', nodeIds: [tube.a, tube.b], partIds: [tube.id] });
  const validTubes = values(model, 'tubes').every(t => model.nodes.has(t.a) && model.nodes.has(t.b));
  let regions = validTubes ? applyConfig(model, automaticRegions(model), config, diagnostics) : [];
  if (!config.order && order !== 'y+') {
    const priority = coordOf(order);
    const center = r => r.nodeIds.length ? r.nodeIds.reduce((sum, id) => sum + priority(model.nodes.get(id)), 0) / r.nodeIds.length : 0;
    regions.sort((a, b) => center(a) - center(b) || a.id.localeCompare(b.id));
  }
  const letters = number => { let out = ''; for (let n = number + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; };
  [...regions].sort((a, b) => (a.supportRank ?? 0) - (b.supportRank ?? 0) || a.id.localeCompare(b.id)).forEach((r, i) => { r.label = letters(i); });
  const interfaces = [], frameModules = [], steps = [], owner = new Map(), lastStep = new Map(), partRegion = new Map();
  for (const r of regions) for (const id of r.partIds) partRegion.set(id, r.id);
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const pair = [regions[i], regions[j]].sort((a, b) => (a.supportRank ?? 0) - (b.supportRank ?? 0));
    const source = pair[0], target = pair[1];
    for (const id of source.nodeIds.filter(id => target.nodeIds.includes(id))) {
      const node = model.nodes.get(id);
      const ownsNode = target.ownedNodeIds.includes(id);
      const tube = (ownsNode ? source : target).tubeIds.map(id => model.tubes.get(id)).filter(t => t.a === id || t.b === id).sort((a, b) => model.nodes.get(a.a === id ? a.b : a.a).y - model.nodes.get(b.a === id ? b.b : b.a).y)[0];
      if (!tube) continue;
      const other = tube && model.nodes.get(tube.a === id ? tube.b : tube.a);
      let actualPort;
      if(tube.link&&node.c45file&&node.c45quat){
        const ex=xAxisOf(normalizedAssemblyQuaternion(node.c45quat)),ey=yAxisOf(normalizedAssemblyQuaternion(node.c45quat)),diagonal=C45_ARM_LEN*Math.SQRT1_2,mouth=point(node).map((v,i)=>v+ex[i]*(C45_SLEEVE_LEN-diagonal)+ey[i]*diagonal),direction=ex.map((v,i)=>-v*Math.SQRT1_2+ey[i]*Math.SQRT1_2);
        const receiving=[...model.tubes.values()].filter(t=>!t.arm&&!t.link&&(t.a===other.id||t.b===other.id)&&t.geom?.dir&&t.geom.dir.reduce((sum,v,i)=>sum+v*direction[i]*(t.a===other.id?1:-1),0)>.99);
        if(distance(mouth,point(other))<.15&&receiving.length===1)actualPort={direction,supportTubeId:receiving[0].id,mateNodeId:other.id,position:mouth,basis:'qdf-file-C45-mouth-and-matching-receiver-axis'};
      }
      interfaces.push({ id: `interface-${interfaces.length + 1}`, sourceRegionId: source.id, targetRegionId: target.id, nodeId: id, position: actualPort?.position||point(node), direction: actualPort?actualPort.direction.map(v=>ownsNode?v:-v):other ? norm(model._tubeDirAt(tube, node, other)).map(v => ownsNode ? v : -v) : [0, 1, 0],...(actualPort?{supportTubeId:actualPort.supportTubeId,mateNodeId:actualPort.mateNodeId,directionBasis:actualPort.basis}:{}) });
    }
  }
  for (const clamp of model.clamps.values()) {
    const base=model._clampBaseTube?.(clamp),cohort=model.clampCohort?.(clamp.id),source=base&&regions.find(region=>region.tubeIds.includes(base.id));
    // A threaded ring's material owner can move to its first carrier layer.
    // Its physical interface still connects the base rail to the other frame.
    const targets=regions.filter(region=>region!==source&&[...(cohort?.tubes||[])].some(id=>id!==base?.id&&region.tubeIds.includes(id)));
    if(source)for(const target of targets)interfaces.push({id:'',sourceRegionId:source.id,targetRegionId:target.id,nodeId:null,clampId:clamp.id,position:point(clamp),direction:[0,-1,0],attachment:clamp.connectorId==='tube_clamp'?'clamp-close':'prethread-ring',supportTubeId:base.id});
  }
  for (const n of model.nodes.values()) if (n.clampOn) {
    const source = regions.find(r => r.tubeIds.includes(n.clampOn.tubeId)), target = regions.find(r => r.ownedNodeIds.includes(n.id));
    if (source && target && source.id !== target.id) interfaces.push({ id: '', sourceRegionId: source.id, targetRegionId: target.id, nodeId: n.id, position: point(n), direction: [0, -1, 0], attachment: 'tube-clamp', supportTubeId: n.clampOn.tubeId });
  }
  const firstBody = [...regions].filter(r => r.kind === 'body').sort((a, b) => a.supportRank - b.supportRank)[0];
  for (const r of regions) if (r.kind === 'body' && r !== firstBody && !interfaces.some(m => m.targetRegionId === r.id)) {
    const floor = r.nodeIds.map(id => model.nodes.get(id)).sort((a, b) => a.y - b.y)[0];
    if (floor && floor.y <= EPS) interfaces.push({ id: '', sourceRegionId: 'ground', targetRegionId: r.id, nodeId: null, position: [floor.x, 0, floor.z], direction: [0, -1, 0], attachment: 'place-on-ground' });
  }
  for (const r of regions) if (r.supportRegionId && r.anchor && !interfaces.some(a => a.targetRegionId === r.id)) interfaces.push({ id: `interface-${interfaces.length + 1}`, sourceRegionId: r.supportRegionId, targetRegionId: r.id, nodeId: null, position: r.anchor, direction: [0, -1, 0] });
  interfaces.sort((a, b) => a.sourceRegionId.localeCompare(b.sourceRegionId) || a.targetRegionId.localeCompare(b.targetRegionId) || String(a.nodeId || a.clampId || '').localeCompare(String(b.nodeId || b.clampId || '')));
  interfaces.forEach((mark, i) => { mark.id = `interface-${i + 1}`; });
  // 用户顺序是相互独立区域的优先级；物理支撑关系始终稳定，并通过 topo 排序兑现。
  const pending = [...regions], scheduled = [], ready = new Set(['ground']);
  while (pending.length) {
    const index = pending.findIndex(r => interfaces.filter(a => a.targetRegionId === r.id).every(a => ready.has(a.sourceRegionId)));
    if (index < 0) { diagnostics.push({ code: 'ASSEMBLY_DEPENDENCY_CYCLE', severity: 'error', message: '区域接口形成循环依赖，请合并相互支撑的区域。', nodeIds: [], partIds: pending.flatMap(r => r.partIds) }); scheduled.push(...pending); break; }
    const [r] = pending.splice(index, 1); scheduled.push(r); ready.add(r.id);
  }
  if (config.order && scheduled.some((r, i) => r.id !== regions[i]?.id)) diagnostics.push({ code: 'REGION_ORDER_ADJUSTED', severity: 'warning', message: '区域顺序已按物理支撑关系调整。', nodeIds: [], partIds: [] });
  regions = scheduled;
  const levels = [];
  for (const y of values(model, 'nodes').map(coord).sort((a, b) => a - b)) if (!levels.length || Math.abs(y - levels.at(-1)) > EPS) levels.push(y);
  const bounds = values(model, 'nodes');
  const width = bounds.length ? Math.max(...bounds.map(n => n.x)) - Math.min(...bounds.map(n => n.x)) : 0;
  const createStep = (r, keyIds, action, title) => {
    const partIds = Object.values(keyIds).flatMap(ids => ids || []), id = `step-${steps.length + 1}`;
    const marks = interfaces.filter(a => a.targetRegionId === r.id && a.attachment !== 'upper-frame');
    const operationMarks = action.scope === 'parts' ? [] : ['attach', 'join'].includes(action.type) ? marks : [];
    const dependsOn = [...new Set(marks.map(a => lastStep.get(a.sourceRegionId)).filter(Boolean))];
    if (lastStep.has(r.id)) dependsOn.push(lastStep.get(r.id));
    const positions = r.nodeIds.map(id => model.nodes.get(id));
    const y = positions.length ? Math.min(...positions.map(coord)) : 0;
    const step = { id, regionId: r.id, kind: action.type === 'attach' ? 'attach' : action.type === 'preassemble' ? 'preassembly' : 'frame', title, instructions: [], level: levels.findIndex(v => Math.abs(v - y) < EPS), y, action, dependsOn: [...new Set(dependsOn)], interfaceIds: operationMarks.map(a => a.id), partIds, parts: emptyParts(), connectors: [], tubes: [], panels: [], textiles: [], slides: [], fittings: [], screws: [], reinforcements: [], openEnds: 0, ...Object.fromEntries(Object.keys(MAPS).map(k => [k, keyIds[k] || []])) };
    steps.push(step); lastStep.set(r.id, id);
    if (action.type !== 'attach') for (const partId of partIds) { if (owner.has(partId)) diagnostics.push({ code: 'DUPLICATE_PART_STEP', severity: 'error', message: '同一部件被重复安装。', partIds: [partId], nodeIds: [] }); owner.set(partId, steps.length - 1); }
    return step;
  };
  const planUpperFrames = (r, frame, nodeIds, y) => {
    const modules = [], installedInLayer = [];
    const physical = frame.filter(t => !t.arm && !t.link && !t.bow);
    const byNode = new Map();
    for (const t of physical) for (const id of [t.a, t.b]) { if (!byNode.has(id)) byNode.set(id, []); byNode.get(id).push(t.id); }
    const tubeGroups = components(physical.map(t => t.id), id => { const t = model.tubes.get(id); return [t.a, t.b].flatMap(n => byNode.get(n) || []); });
    for (const tubeIds of tubeGroups) {
      const installedTubeIds = [...owner.keys()].filter(id => model.tubes.has(id)).concat(installedInLayer);
      const moduleNodes = [...new Set(tubeIds.flatMap(id => { const t = model.tubes.get(id); return [t.a, t.b]; }))];
      const module = { id: `frame-${r.id}-${frameModules.length + 1}`, regionId: r.id, y, nodeIds: moduleNodes, tubeIds, partIds: [...moduleNodes, ...tubeIds], status: 'in-place', interfaceIds: [] };
      const supports = installedTubeIds.map(id => model.tubes.get(id)).filter(t => !t.arm && !t.link && moduleNodes.some(id => {
        if (t.a !== id && t.b !== id) return false;
        const other = model.nodes.get(t.a === id ? t.b : t.a);
        return other.y < y - EPS;
      }));
      if (!supports.length) continue;
      const supportsVertical = supports.every(t => !t.bow && Math.abs(model.nodes.get(t.a).x - model.nodes.get(t.b).x) < EPS && Math.abs(model.nodes.get(t.a).z - model.nodes.get(t.b).z) < EPS);
      const owned = moduleNodes.every(id => nodeIds.includes(id) && !owner.has(id));
      const boundary = installedTubeIds.map(id => model.tubes.get(id)).filter(t => moduleNodes.some(id => t.a === id || t.b === id)).some(t => !supports.includes(t));
      if (!owned || !supportsVertical || boundary) {
        module.reason = !owned ? 'connector-already-installed-or-owned-by-another-region' : !supportsVertical ? 'support-axes-not-vertical' : 'fixed-boundary-tube'; frameModules.push(module); continue;
      }
      // This first pass establishes a possible structural frame grouping.
      // Accessories have not been physically scheduled yet: ledger ownership
      // does not establish their installed pose. Operations below check all
      // installed/prepared accessories at their actual poses on every leg.
      const installed = [{tubeIds:installedTubeIds,nodeIds:[...owner.keys()].filter(id=>model.nodes.has(id))}];
      const highest = Math.max(y, ...installedTubeIds.flatMap(id => { const t = model.tubes.get(id); return [model.nodes.get(t.a).y, model.nodes.get(t.b).y]; }));
      const clearance = Math.max(18, highest - y + (geometry().tubeRadius || 2.45) * 2 + 10);
      const minX = Math.min(...moduleNodes.map(id => model.nodes.get(id).x));
      const side = [(bounds.length ? Math.max(...bounds.map(n => n.x)) : 0) + 65 - minX, 0, 0];
      const above = [0, clearance, 0], transportPath = [side, [side[0], clearance, 0], above, [0, 0, 0]];
      let obstruction = null;
      for (let leg = 0; leg < transportPath.length - 1 && !obstruction; leg++) obstruction = insertionObstruction(model, module, installed, transportPath[leg], transportPath[leg + 1], leg === transportPath.length - 2);
      if (obstruction) { module.reason = 'installation-path-blocked'; module.obstruction = obstruction; frameModules.push(module); continue; }
      const marks = supports.map(t => {
        const nodeId = moduleNodes.find(id => t.a === id || t.b === id), n = model.nodes.get(nodeId);
        const mark = { id: `interface-${interfaces.length + 1}`, sourceRegionId: r.id, targetRegionId: r.id, assemblyId: module.id, nodeId, supportTubeId: t.id, supportStepId: steps[owner.get(t.id)]?.id, position: point(n), direction: [0, -1, 0], attachment: 'upper-frame' };
        interfaces.push(mark); return mark;
      });
      Object.assign(module, { status: 'lowerable', interfaceIds: marks.map(m => m.id), installationTranslation: above, transportPath, installation: { direction: [0, -1, 0], commonAxis: true, pathVerified: true, sampleSpacing: geometry().tubeRadius || 2.45, pathSamples: transportPath.slice(1).map((p, i) => Math.ceil(distance(transportPath[i], p) / (geometry().tubeRadius || 2.45)) + 1) } });
      frameModules.push(module);
      modules.push(module); installedInLayer.push(...tubeIds);
    }
    return modules;
  };
  for (const r of regions) {
    const preassemble = ['roof', 'ramp', 'slide'].includes(r.kind);
    const marks = interfaces.filter(a => a.targetRegionId === r.id && a.attachment !== 'upper-frame'), direction = marks[0]?.direction || [0, -1, 0];
    const commonAxis = marks.every(m => m.direction.reduce((s, v, i) => s + v * direction[i], 0) > 0.97);
    r.installation = { direction, commonAxis, clearance: Math.max(45, width * 0.4), pathVerified: false };
    r.detachedTranslation = direction.map(v => -v * r.installation.clearance);
    const detachable = preassemble && (commonAxis || r.kind === 'slide');
    const bodyModule = r.kind === 'body' && marks.some(mark=>mark.attachment!=='place-on-ground') && commonAxis;
    if (preassemble && !commonAxis && r.kind === 'roof') diagnostics.push({ code: 'INCOMPATIBLE_INTERFACE_AXES', severity: 'error', message: '预装模块的接口无法沿同一方向插接，请将边界框架纳入模块或调整区域。', nodeIds: marks.map(m => m.nodeId).filter(Boolean), partIds: r.partIds });
    if (preassemble && !commonAxis && r.kind === 'ramp') { r.installation.mode = 'in-place'; r.installation.pathVerified = false; }
    if (preassemble && commonAxis) {
      const minY = r.nodeIds.length ? Math.min(...r.nodeIds.map(id => model.nodes.get(id).y)) : r.anchor?.[1] || 0;
      const installed = regions.slice(0, regions.indexOf(r));
      const obstruction = r.kind === 'roof' ? insertionObstruction(model, r, installed, r.detachedTranslation) : null;
      // 采样步距不超过管半径，并用半步距扩张间隙，覆盖相邻姿态之间的运动。
      r.installation.pathVerified = !obstruction;
      r.installation.pathSamples = Math.max(1, Math.ceil(Math.hypot(...r.detachedTranslation) / (geometry().tubeRadius || 2.45))) + 1;
      r.installation.sampleSpacing = Math.hypot(...r.detachedTranslation) / (r.installation.pathSamples - 1);
      if (obstruction && r.kind === 'roof') diagnostics.push({ code: 'INSTALLATION_PATH_BLOCKED', severity: 'error', message: '屋顶安装通道被相邻管件占用，请调整区域或安装顺序。', nodeIds: [], partIds: [obstruction.movingTubeId, obstruction.obstacleTubeId], details: obstruction });
    }
    const keys = { ...Object.fromEntries(Object.keys(MAPS).map(k => [k, r[k]])), nodeIds: r.ownedNodeIds };
    for (const key of ['panelIds', 'fittingIds']) keys[key] = keys[key].filter(id => !isOriginalComponent(model[MAPS[key]].get(id)));
    if(r.kind==='slide'&&['slide','roof-cover'].includes(r.accessoryType)){
      r.detachedTranslation=[0,0,0];r.installation.mode='slide-specific-accessory-sequence';r.installation.pathVerified=false;
      const ordered=[...keys.slideIds].sort((a,b)=>(model.slides.get(a)?.kind==='slide-end2'?0:1)-(model.slides.get(b)?.kind==='slide-end2'?0:1));
      for(const id of ordered)createStep(r,{slideIds:[id]},{type:'build',translation:[0,0,0],detached:false},model.slides.get(id)?.kind==='roof2'?copy('屋顶：从上方安装覆件','Roof: fit the covering from above','Dach: Abdeckung von oben aufsetzen'):model.slides.get(id)?.kind==='slide-end2'?copy('滑梯：安装缓冲尾段','Slide: install the runout','Rutsche: Auslauf montieren'):copy('滑梯：安装本体','Slide: install the body','Rutsche: Hauptteil montieren'));
    }else if (detachable || r.kind === 'roof') {
      if (r.kind === 'roof') {
        const usedNodes = new Set(), usedTubes = new Set();
        const preassemble = (ids, title) => createStep(r, ids, { type: 'preassemble', translation: r.detachedTranslation, detached: true }, title);
        let triangle = 0;
        for (const id of keys.nodeIds) {
          const apex = model.nodes.get(id);
          const pair = keys.tubeIds.map(id => model.tubes.get(id)).filter(t => !t.arm && !t.link && !t.bow && (t.a === id || t.b === id)).filter(t => {
            const other = model.nodes.get(t.a === id ? t.b : t.a), d = norm([other.x - apex.x, other.y - apex.y, other.z - apex.z]);
            return other.y < apex.y - EPS && Math.abs(Math.abs(d[1]) - Math.SQRT1_2) < 0.08;
          });
          if (pair.length !== 2 || pair.some(t => usedTubes.has(t.id))) continue;
          const nodeIds = [...new Set([id, ...pair.flatMap(t => [t.a, t.b]).filter(n => model.nodes.get(n)?.c45body)])].filter(n => keys.nodeIds.includes(n) && !usedNodes.has(n));
          for (const n of nodeIds) usedNodes.add(n); for (const t of pair) usedTubes.add(t.id);
          triangle++;
          preassemble({ nodeIds, tubeIds: pair.map(t => t.id) }, copy(`${r.name}：预装尖顶 ${triangle} 的两斜管与顶端连接件`, `${r.name}: preassemble roof triangle ${triangle}`, `${r.name}: Dachspitze ${triangle} vormontieren`));
        }
        const remaining = keys.tubeIds.filter(id => !usedTubes.has(id)).sort((a, b) => {
          const y = id => { const t = model.tubes.get(id); return Math.min(model.nodes.get(t.a).y, model.nodes.get(t.b).y); };
          return y(a) - y(b) || a.localeCompare(b);
        });
        let section = 0;
        for (let i = 0; i < remaining.length; i += 10) {
          const tubeIds = remaining.slice(i, i + 10), nodeIds = [...new Set(tubeIds.flatMap(id => { const t = model.tubes.get(id); return [t.a, t.b]; }))].filter(id => keys.nodeIds.includes(id) && !usedNodes.has(id));
          for (const id of nodeIds) usedNodes.add(id);
          section++;
          preassemble({ nodeIds, tubeIds }, copy(`${r.name}：补齐屋顶框架 ${section}`, `${r.name}: complete roof frame ${section}`, `${r.name}: Dachrahmen ${section} ergänzen`));
        }
        const finalIds = { nodeIds: keys.nodeIds.filter(id => !usedNodes.has(id)), clampIds: keys.clampIds, panelIds: keys.panelIds, textileIds: keys.textileIds, slideIds: keys.slideIds, fittingIds: keys.fittingIds };
        if (Object.values(finalIds).some(ids => ids.length)) preassemble(finalIds, copy(`${r.name}：固定屋顶附件`, `${r.name}: fit roof accessories`, `${r.name}: Dachzubehör befestigen`));
      } else {
        createStep(r, keys, { type: 'preassemble', translation: r.detachedTranslation, detached: true }, copy(`预装 ${r.name}`, `Preassemble ${r.name}`, `${r.name} vormontieren`));
      }
      createStep(r, Object.fromEntries(Object.keys(MAPS).map(k => [k, keys[k]])), { type: 'attach', translation: [0, 0, 0], detached: false }, copy(`安装 ${r.name}`, `Attach ${r.name}`, `${r.name} ansetzen`));
    } else {
      const buildAction = bodyModule ? { type: 'preassemble', translation: r.detachedTranslation, detached: true } : { type: 'build', translation: [0, 0, 0], detached: false };
      if (r.kind === 'body' && marks.length && !commonAxis) diagnostics.push({ code: 'INCOMPATIBLE_BODY_INTERFACES', severity: 'error', message: '自定义主体区域无法整体插接，请合并连续主体或调整边界管件。', nodeIds: marks.map(m => m.nodeId).filter(Boolean), partIds: r.partIds });
      if (bodyModule) {
        const obstruction = insertionObstruction(model, r, regions.slice(0, regions.indexOf(r)), r.detachedTranslation);
        r.installation.pathVerified = !obstruction;
        r.installation.pathSamples = Math.max(1, Math.ceil(Math.hypot(...r.detachedTranslation) / (geometry().tubeRadius || 2.45))) + 1;
        r.installation.sampleSpacing = Math.hypot(...r.detachedTranslation) / (r.installation.pathSamples - 1);
        if (obstruction) diagnostics.push({ code: 'INSTALLATION_PATH_BLOCKED', severity: 'error', message: '主体区域安装通道被相邻管件占用。', nodeIds: [], partIds: [obstruction.movingTubeId, obstruction.obstacleTubeId], details: obstruction });
      }
      const ownLevels = [...new Set([...keys.nodeIds.map(id => model.nodes.get(id).y), ...keys.tubeIds.map(id => { const t = model.tubes.get(id); return Math.min(model.nodes.get(t.a).y, model.nodes.get(t.b).y); }), ...keys.clampIds.map(id => model.clamps.get(id).y)])].sort((a, b) => a - b);
      const bucket = v => ownLevels.find(y => Math.abs(y - v) < EPS) ?? v;
      for (const y of ownLevels.filter((y, i) => !i || Math.abs(y - ownLevels[i - 1]) > EPS)) {
        const nodeIds = keys.nodeIds.filter(id => bucket(model.nodes.get(id).y) === y);
        const clampIds = keys.clampIds.filter(id => bucket(model.clamps.get(id).y) === y);
        const at = keys.tubeIds.map(id => model.tubes.get(id)).filter(t => bucket(Math.min(model.nodes.get(t.a).y, model.nodes.get(t.b).y)) === y);
        const frame = at.filter(t => Math.abs(model.nodes.get(t.a).y - model.nodes.get(t.b).y) <= EPS), risers = at.filter(t => !frame.includes(t));
        const modules = planUpperFrames(r, frame, nodeIds, y);
        if (nodeIds.length || frame.length || clampIds.length) {
          const action = modules.length ? { ...buildAction, scope: 'parts', layer: true, modules: modules.map(m => ({ id: m.id, partIds: m.partIds, translation: m.installationTranslation, interfaceIds: m.interfaceIds })) } : buildAction;
          const title = modules.length ? copy(`${r.name}：${Math.round(y)} cm 本层框架向下套入`, `${r.name}: lower frames at ${Math.round(y)} cm`, `${r.name}: Rahmen auf ${Math.round(y)} cm absenken`) : copy(`${r.name}：${Math.round(y)} cm 框架`, `${r.name}: frame at ${Math.round(y)} cm`, `${r.name}: Rahmen auf ${Math.round(y)} cm`);
          const s = createStep(r, { nodeIds, tubeIds: frame.map(t => t.id), clampIds }, action, title); s.y = y; s.kind = 'frame';
          if (modules.length) {
            const moving = new Set(modules.flatMap(m => m.partIds));
            s.action.inPlacePartIds = s.partIds.filter(id => !moving.has(id));
            s.interfaceIds = modules.flatMap(m => m.interfaceIds);
            const marks = interfaces.filter(m => s.interfaceIds.includes(m.id));
            s.dependsOn = [...new Set([...s.dependsOn, ...marks.map(m => m.supportStepId).filter(Boolean)])];
            s.instructions = [copy('先拼好本层各框架与接头，再分别对齐立柱向下套入。', 'Preassemble each frame with connectors, then lower each onto its uprights.', 'Rahmen mit Kupplungen vormontieren, dann jeweils auf die Stützen absenken.')];
            if (s.action.inPlacePartIds.length) s.instructions.push(copy('其余本层部件在位安装，不随框架下移。', 'Fit remaining parts in place; they do not move with the frames.', 'Übrige Teile vor Ort montieren; sie bewegen sich nicht mit den Rahmen.'));
            for (const module of modules) module.installStepId = s.id;
          }
        }
        if (risers.length) { const s = createStep(r, { tubeIds: risers.map(t => t.id) }, buildAction, copy(`${r.name}：向上安装立柱`, `${r.name}: install uprights`, `${r.name}: Stützen einsetzen`)); s.y = y; s.kind = 'risers'; }
      }
      const accessories = Object.fromEntries(['panelIds', 'textileIds', 'slideIds', 'fittingIds'].map(k => [k, keys[k]]));
      if (Object.values(accessories).some(ids => ids.length)) { const s = createStep(r, accessories, buildAction, copy(`固定 ${r.name} 面板与配件`, `Fit panels and accessories of ${r.name}`, `Platten und Zubehör von ${r.name} befestigen`)); s.kind = 'panels'; }
      if (bodyModule) createStep(r, keys, { type: 'attach', translation: [0, 0, 0], detached: false }, copy(`拼接 ${r.name}`, `Join ${r.name}`, `${r.name} verbinden`));
    }
  }
  // 原创套装各自保留经过确认的尺寸、随附固定方式与安装说明。
  for (const [key, name] of [['panelIds', 'panels'], ['fittingIds', 'fittings']]) for (const p of values(model, name)) if (isOriginalComponent(p)) {
    const r = regions.find(r => r.partIds.includes(p.id));
    if (!r) continue;
    const info = componentInstallCopy(componentPartId(p), p);
    const step = createStep(r, { [key]: [p.id] }, { type: 'build', translation: [0, 0, 0] }, info.title);
    Object.assign(step, info, { kind: 'accessories' });
  }
  // 自定义顺序也须符合接口依赖。前置区域未完成时给出可操作诊断。
  for (const step of steps) for (const id of step.interfaceIds) {
    const mark = interfaces.find(a => a.id === id), support = regions.find(r => r.id === mark.sourceRegionId);
    if (mark.attachment === 'upper-frame') {
      if (!mark.supportStepId || steps.findIndex(s => s.id === mark.supportStepId) >= steps.indexOf(step)) diagnostics.push({ code: 'INVALID_UPPER_FRAME_ORDER', severity: 'error', message: '上层框架安装前尚未装好支撑立柱。', nodeIds: [mark.nodeId], partIds: [mark.supportTubeId] });
      continue;
    }
    const supportSteps = steps.filter(s => s.regionId === support?.id && s.kind !== 'accessories');
    if (supportSteps.length && steps.indexOf(supportSteps.at(-1)) >= steps.indexOf(step) && step.action.type !== 'preassemble') diagnostics.push({ code: 'INVALID_ASSEMBLY_ORDER', severity: 'error', message: '接口支撑区域尚未完成，请调整区域顺序。', nodeIds: mark.nodeId ? [mark.nodeId] : [], partIds: [] });
  }
  scheduleAssemblyAccessories(model, steps, diagnostics, regions,deferredAccessories);
  owner.clear();
  steps.forEach((step, i) => { if (step.action.type !== 'attach') for (const id of step.partIds) owner.set(id, i); });
  const bom = computeBOM(model), ledger = allocateBOM(model, bom, steps, owner, diagnostics);
  const fixingPoints = [];
  for (const step of steps) for (const group of GROUPS) step[group] = step.parts[group];
  // 只展示真实的单口插接。已固定两端的管件不能画成从一侧强行插入。
  const installedParts = new Set();
  for (const step of steps) {
    const operations = [];
    if (['build', 'preassemble'].includes(step.action.type) && step.action.scope !== 'parts') {
      const addedNodes = new Set(step.nodeIds), region = regions.find(r => r.id === step.regionId);
      for (const id of step.tubeIds) {
        const tube = model.tubes.get(id);
        if (!tube || tube.arm || tube.link || tube.bow) continue;
        const available = [tube.a, tube.b].filter(id => installedParts.has(id) &&
          (!step.action.detached || region.ownedNodeIds.includes(id)));
        if (available.length !== 1) continue;
        const anchorId = available[0], freeId = tube.a === anchorId ? tube.b : tube.a;
        if (addedNodes.has(freeId) && step.tubeIds.some(id => id !== tube.id &&
          [model.tubes.get(id).a, model.tubes.get(id).b].includes(freeId))) continue;
        const anchor = model.nodes.get(anchorId), free = model.nodes.get(freeId);
        const outward = norm(model._tubeDirAt(tube, anchor, free));
        const translation = outward.map(v => v * Math.max(10, Math.min(18, (tube.length || 35) * 0.4)));
        operations.push({ id: `insert-${step.id}-${id}`, partIds: [id, ...(addedNodes.has(freeId) ? [freeId] : [])], position: point(anchor), translation, direction: outward.map(v => -v) });
      }
    }
    step.action = { ...step.action, operations };
    for (const id of step.partIds) installedParts.add(id);
  }
  for (const [name] of Object.entries(MAPS)) for (const p of values(model, MAPS[name])) if (!owner.has(p.id)) diagnostics.push({ code: 'PART_UNASSIGNED', severity: 'error', message: `部件 ${p.id} 没有区域或装配步骤。`, nodeIds: MAPS[name] === 'nodes' ? [p.id] : [], partIds: [p.id] });
  const plan = { version: 2, adjustments:[], order, regions, interfaces, frameModules, fixingPoints, steps, diagnostics, bom, ledger, levels, verification: { directionChecked: false, pathChecked: false, methodChecked: false, physical: 'unverified', load: 'unverified' }, canExport: false };
  addAssemblyOperations(model, plan);
  // A blocked lowering path may be opened by installing its covering later.
  // Rebuild the actual action plan and recheck every subsequent motion; never
  // retain a geometric exemption merely because the first candidate failed.
  if((internal.attempt||0)<2){
    const candidates=frameModules.filter(module=>module.reason==='installation-path-blocked'&&model.panels.has(module.obstruction?.obstaclePartId));
    for(const diagnostic of diagnostics.filter(d=>d.code==='INSTALLATION_PATH_BLOCKED'&&d.details?.type==='lower-frame'&&model.panels.has(d.details.obstaclePartId))){const step=steps.find(step=>step.operations.some(op=>op.id===diagnostic.details.operationId));if(step)candidates.push({tubeIds:step.tubeIds,obstruction:diagnostic.details});}
    const candidate=candidates.find(module=>!deferredIds.has(module.obstruction.obstaclePartId));
    if(candidate){const request={partId:candidate.obstruction.obstaclePartId,afterTubeIds:candidate.tubeIds,reason:'blocked-lowering-path'},history=[...(internal.history||[]),{...request,blockedBy:candidate.obstruction.obstaclePartId}];return computeAssemblyPlan(model,config,order,{attempt:(internal.attempt||0)+1,deferredAccessories:[...deferredAccessories,request],history});}
  }
  plan.adjustments=internal.history||[];
  consolidateLayerSteps(plan, rowKey);
  plan.canExport = ledger.conserved && plan.verification.directionChecked && plan.verification.pathChecked && plan.verification.methodChecked && !diagnostics.some(d => d.severity === 'error');
  return plan;
}

/** 渲染器只消费此快照。已预装模块保持分离，直到安装步骤才归位。 */
export function assemblyState(plan, index, { action = false } = {}) {
  const done = new Set(), current = new Set(), visible = new Set(), transforms = new Map(), arrows = [];
  const hiddenNewParts = new Set();
  const end = Math.min(Math.max(-1, index), plan.steps.length - 1);
  const detached = new Map(), detachedFrames = new Map();
  for (let i = 0; i <= end; i++) {
    const step = plan.steps[i];
    if (step.action?.type === 'preassemble') {
      if (step.action.scope === 'parts') detachedFrames.set(step.action.assemblyId, { partIds: step.action.partIds, translation: step.action.translation });
      else detached.set(step.regionId, step.action.translation);
    }
    if (step.action?.type === 'attach') {
      if (step.action.scope === 'parts') detachedFrames.delete(step.action.assemblyId);
      else detached.delete(step.regionId);
    }
    for (const id of step.partIds || idsOf(step)) {
      visible.add(id);
      if (i === end) current.add(id); else done.add(id);
    }
  }
  for (const id of current) done.delete(id);
  for (const [regionId, translation] of detached) for (const id of plan.regions.find(r => r.id === regionId)?.partIds || []) if (visible.has(id)) transforms.set(id, translation);
  for (const frame of detachedFrames.values()) for (const id of frame.partIds) if (visible.has(id)) transforms.set(id, frame.translation.map((v, i) => v + (transforms.get(id)?.[i] || 0)));
  const step = plan.steps[end];
  const interfaceMarks = (step?.interfaceIds || []).map(id => plan.interfaces.find(a => a.id === id)).filter(Boolean);
  if (action && step?.action?.type === 'attach') {
    const region = plan.regions.find(r => r.id === step.regionId), local = step.action.scope === 'parts';
    const translation = local ? step.action.translation : region?.detachedTranslation || [0, 30, 0];
    const regionTranslation = local ? detached.get(step.regionId) || [0, 0, 0] : [0, 0, 0];
    for (const id of local ? step.action.partIds : region?.partIds || []) if (visible.has(id)) transforms.set(id, translation.map((v, i) => v + regionTranslation[i]));
    // 动作帧保持模块分离，完成帧移回最终位置。
    for (const mark of interfaceMarks) {
      const to = mark.position.map((v, i) => v + regionTranslation[i]);
      arrows.push({ id: mark.id, from: to.map((v, i) => v + translation[i]), to, direction: norm(translation.map(v => -v)), regionId: step.regionId });
    }
  }
  if (action && step?.action?.layer) {
    const regionTranslation = detached.get(step.regionId) || [0, 0, 0];
    for (const module of step.action.modules) {
      for (const id of module.partIds) if (visible.has(id)) transforms.set(id, module.translation.map((v, axis) => v + regionTranslation[axis]));
      for (const id of module.interfaceIds) {
        const mark = plan.interfaces.find(m => m.id === id), to = mark.position.map((v, axis) => v + regionTranslation[axis]);
        arrows.push({ id, assemblyId: module.id, from: to.map((v, axis) => v + module.translation[axis]), to, direction: [0, -1, 0], regionId: step.regionId });
      }
    }
    for (const id of step.action.inPlacePartIds || []) { visible.delete(id); current.delete(id); done.delete(id); transforms.delete(id); hiddenNewParts.add(id); }
  }
  if (action) for (const operation of step?.action?.operations || []) {
    // A merged layer overview lowers its frames first. Later in-place parts
    // are hidden above, so their arrows belong only to their ordered details.
    if (step.action.layer && !operation.partIds.some(id => visible.has(id))) continue;
    const regionTranslation = detached.get(step.regionId) || [0, 0, 0];
    for (const id of operation.partIds) if (visible.has(id)) transforms.set(id,
      operation.translation.map((v, axis) => v + (transforms.get(id)?.[axis] || 0)));
    const to = operation.position.map((v, axis) => v + regionTranslation[axis]);
    arrows.push({ id: operation.id, from: to.map((v, axis) => v + operation.translation[axis]), to, direction: operation.direction, regionId: step.regionId });
  }
  if (action && step?.action?.type === 'preassemble' && step.action.scope === 'parts') {
    for (const id of step.action.partIds) {
      visible.delete(id); current.delete(id); done.delete(id); transforms.delete(id); hiddenNewParts.add(id);
    }
  } else if (action && ['build', 'preassemble'].includes(step?.action?.type) && !step.action.layer) {
    const moving = new Set((step.action.operations || []).flatMap(operation => operation.partIds));
    const beforeKeys = ['tubeIds', 'panelIds', 'textileIds', 'slideIds', 'fittingIds', 'clampIds'];
    // 只新增接头的步骤也展示装配前；纯拓扑 link 不代表新增实体管。
    if (!step.parts?.tubes?.length) beforeKeys.push('nodeIds');
    for (const id of beforeKeys.flatMap(key => step[key] || [])) {
      if (moving.has(id)) continue;
      visible.delete(id); current.delete(id); done.delete(id); transforms.delete(id); hiddenNewParts.add(id);
    }
  }
  return { done, current, visible, transforms, arrows, interfaceMarks, hiddenNewParts, actionStage: action && hiddenNewParts.size && !step?.action?.layer ? 'before' : 'installation', fixingPoints: (plan.fixingPoints || []).filter(p => p.stepId === step?.id) };
}


/** One local action group. Future actions remain hidden in both action and completion frames. */
export function assemblyDetailState(plan, index, groupId, { action = false } = {}) {
  const step = plan.steps[index], group = step?.detailGroups?.find(g => g.id === groupId);
  if (!group) return { ...assemblyState(plan, index, { action }), focusPartIds: [], operationNumbers: [],profileTransforms:new Map(),profileVisible:new Set() };
  const base = assemblyState(plan, index - 1), operations = step.operations || [];
  const profileTransforms=new Map(),profileVisible=new Set(),profileCarriers=new Map(plan.steps.flatMap(step=>step.operations||[]).filter(op=>op.type==='preinsert-reinforcement').map(op=>[op.profileKey||op.partIds[0],op.partIds[0]]));
  for(const prior of plan.steps.slice(0,index))for(const op of prior.operations||[])if(op.type==='preinsert-reinforcement')profileVisible.add(op.profileKey||op.partIds[0]);
  for(const id of base.current)base.done.add(id);base.current.clear();
  const selected = new Set(group.operationIds), last = operations.findLastIndex(op => selected.has(op.id));
  const first = operations.findIndex(op => selected.has(op.id));
  for (let i = 0; i <= last; i++) {
    const op = operations[i], offset = op.placementTranslation || [0,0,0];
    for (const id of op.consumesPartIds || []) {
      base.visible.add(id); base.done.add(id);
      if (offset.some(v => v)) base.transforms.set(id, [...offset]); else base.transforms.delete(id);
    }
    if(op.type==='preinsert-reinforcement'){profileVisible.add(op.profileKey||op.partIds[0]);profileTransforms.set(op.profileKey||op.partIds[0],[...offset]);}
    else if (op.translation||op.type==='unfold-flexible-liner') for (const id of op.partIds) {
      if(offset.some(v=>v))base.transforms.set(id,[...offset]);else base.transforms.delete(id);
    }
    if(op.type!=='preinsert-reinforcement'&&op.translation)for(const [key,carrier]of profileCarriers)if(profileVisible.has(key)&&op.partIds.includes(carrier))profileTransforms.set(key,[...offset]);
    if(selected.has(op.id)) {
      for(const id of op.partIds) {base.visible.add(id);base.current.add(id);base.done.delete(id);}
      if(['prepare-core-channel','preinsert-reinforcement','prethread-accessory'].includes(op.type))for(const id of op.referencePartIds || []) {
        base.visible.add(id);base.current.add(id);base.done.delete(id);
        const loose=op.displayTransforms?.[id] || offset;
        if(loose.some(v=>v))base.transforms.set(id,loose);else base.transforms.delete(id);
      }
    }
  }
  base.arrows = [];
  const neededReferences=new Set(operations.filter(op=>selected.has(op.id)&&op.translation).flatMap(op=>op.referencePartIds||[]));
  if (action) for (let i = first; i <= last; i++) {
    const op = operations[i]; if (!selected.has(op.id)) continue;
    const offset=op.placementTranslation || [0,0,0];
    if (op.translation && op.direction) {
      if(op.type==='preinsert-reinforcement')profileTransforms.set(op.profileKey||op.partIds[0],op.translation.map((v,j)=>v+offset[j]));
      else {for (const id of op.partIds) base.transforms.set(id, op.translation.map((v,j)=>v+offset[j]));for(const [key,carrier]of profileCarriers)if(profileVisible.has(key)&&op.partIds.includes(carrier))profileTransforms.set(key,op.translation.map((v,j)=>v+offset[j]));}
      const to = (op.position || [0, step.y, 0]).map((v,j)=>v+offset[j]);
      base.arrows.push({ id:op.id, from:to.map((v,j)=>v+op.translation[j]), to, direction:op.direction, regionId:step.regionId });
    } else if (['orient-connector','fit-accessory','topology-reference'].includes(op.type)) {
      for (const id of op.consumesPartIds || []) { if(neededReferences.has(id))continue;base.visible.delete(id); base.current.delete(id); base.done.delete(id); base.transforms.delete(id); base.hiddenNewParts.add(id); }
    }
  }
  base.interfaceMarks = (step.interfaceIds || []).map(id=>plan.interfaces.find(m=>m.id===id)).filter(Boolean);
  const localIds=operations.filter(op=>selected.has(op.id)).flatMap(op=>op.closesPorts?.length ? op.closesPorts : [...op.partIds,...(op.referencePartIds||[]).filter(id=>group.partIds.includes(id)&&!plan.regions.some(r=>r.tubeIds.includes(id)))]);
  const focusPartIds = [...new Set(localIds.filter(id=>base.visible.has(id)&&group.partIds.includes(id)))];
  const operationNumbers = group.operationNumbers || operations.filter(op=>selected.has(op.id)).map(op=>({id:op.id,order:op.order,partIds:op.partIds}));
  base.actionStage = action && base.hiddenNewParts.size ? 'before' : 'installation';
  return { ...base, focusPartIds, operationNumbers, profileTransforms,profileVisible };
}
