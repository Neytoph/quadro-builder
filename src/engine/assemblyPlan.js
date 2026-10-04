import { computeBOM, connectorsForNode, resolveNodeConnection, reinforcementRuns, textileRow } from './bom.js';
import { reinforcementPart } from './catalog.js';
import { geometry } from './catalog.js';
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

function segmentDistance(a, b, c, d) {
  const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), det = aa * cc - bb * bb;
  let s = det > 1e-8 ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / det)) : 0;
  let t = cc > 1e-8 ? (bb * s + ee) / cc : 0;
  if (t < 0) { t = 0; s = aa > 1e-8 ? Math.max(0, Math.min(1, -dd / aa)) : 0; }
  else if (t > 1) { t = 1; s = aa > 1e-8 ? Math.max(0, Math.min(1, (bb - dd) / aa)) : 0; }
  return Math.hypot(...w.map((x, i) => x + s * u[i] - t * v[i]));
}

function tubePosition(model, tube) {
  if (tube.geom?.p0 && tube.geom?.dir) return [tube.geom.p0, tube.geom.p0.map((v, i) => v + tube.geom.dir[i] * (tube.geom.len + (tube.geom.pad || 0)))];
  return [point(model.nodes.get(tube.a)), point(model.nodes.get(tube.b))];
}

function insertionObstruction(model, region, installed, translation) {
  const tubeRadius = geometry().tubeRadius || 2.45, radius = tubeRadius * 2;
  const travel = Math.hypot(...translation), sampleCount = Math.max(1, Math.ceil(travel / tubeRadius));
  const halfStep = travel / sampleCount / 2;
  const obstacles = installed.flatMap(r => r.tubeIds).map(id => model.tubes.get(id)).filter(t => t && !t.arm && !t.link && !t.bow);
  for (const id of region.tubeIds) {
    const moving = model.tubes.get(id);
    if (moving.arm || moving.link || moving.bow) continue;
    const [a, b] = tubePosition(model, moving);
    for (const obstacle of obstacles) {
      // 插接口的同轴支撑是终点接合对象，允许管端靠近这一对象。
      if ([moving.a, moving.b].some(id => id === obstacle.a || id === obstacle.b)) continue;
      const [c, d] = tubePosition(model, obstacle);
      for (let sample = 0; sample <= sampleCount; sample++) {
        const delta = translation.map(v => v * (1 - sample / sampleCount));
        const movedA = a.map((v, i) => v + delta[i]), movedB = b.map((v, i) => v + delta[i]);
        const clearance = radius + (sample > 0 && sample < sampleCount ? halfStep : 0);
        if (segmentDistance(movedA, movedB, c, d) < clearance) return { movingTubeId: id, obstacleTubeId: obstacle.id, sample, pathSamples: sampleCount + 1, sampleSpacing: travel / sampleCount, translation: delta };
      }
    }
  }
  return null;
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

export function computeAssemblyPlan(model, config = model.assemblyConfig || {}, order = 'y+') {
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
  const interfaces = [], steps = [], owner = new Map(), lastStep = new Map(), partRegion = new Map();
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
      interfaces.push({ id: `interface-${interfaces.length + 1}`, sourceRegionId: source.id, targetRegionId: target.id, nodeId: id, position: point(node), direction: other ? norm(model._tubeDirAt(tube, node, other)).map(v => ownsNode ? v : -v) : [0, 1, 0] });
    }
  }
  for (const r of regions) for (const clampId of r.clampIds) {
    const clamp = model.clamps.get(clampId), base = model._clampBaseTube?.(clamp);
    const source = base && regions.find(other => other.id !== r.id && other.tubeIds.includes(base.id));
    if (source) interfaces.push({ id: '', sourceRegionId: source.id, targetRegionId: r.id, nodeId: null, clampId, position: point(clamp), direction: [0, -1, 0], attachment: 'clamp-close', supportTubeId: base.id });
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
    const marks = interfaces.filter(a => a.targetRegionId === r.id);
    const operationMarks = ['attach', 'join', 'fix'].includes(action.type) ? marks : [];
    const dependsOn = [...new Set(marks.map(a => lastStep.get(a.sourceRegionId)).filter(Boolean))];
    if (lastStep.has(r.id)) dependsOn.push(lastStep.get(r.id));
    const positions = r.nodeIds.map(id => model.nodes.get(id));
    const y = positions.length ? Math.min(...positions.map(coord)) : 0;
    const step = { id, regionId: r.id, kind: action.type === 'fix' ? 'fix' : action.type === 'attach' ? 'attach' : action.type === 'preassemble' ? 'preassembly' : 'frame', title, instructions: [], level: levels.findIndex(v => Math.abs(v - y) < EPS), y, action, dependsOn: [...new Set(dependsOn)], interfaceIds: operationMarks.map(a => a.id), partIds, parts: emptyParts(), connectors: [], tubes: [], panels: [], textiles: [], slides: [], fittings: [], screws: [], reinforcements: [], openEnds: 0, ...Object.fromEntries(Object.keys(MAPS).map(k => [k, keyIds[k] || []])) };
    steps.push(step); lastStep.set(r.id, id);
    if (action.type !== 'attach') for (const partId of partIds) { if (owner.has(partId)) diagnostics.push({ code: 'DUPLICATE_PART_STEP', severity: 'error', message: '同一部件被重复安装。', partIds: [partId], nodeIds: [] }); owner.set(partId, steps.length - 1); }
    return step;
  };
  for (const r of regions) {
    const preassemble = ['roof', 'ramp', 'slide'].includes(r.kind);
    const marks = interfaces.filter(a => a.targetRegionId === r.id), direction = marks[0]?.direction || [0, -1, 0];
    const commonAxis = marks.every(m => m.direction.reduce((s, v, i) => s + v * direction[i], 0) > 0.97);
    r.installation = { direction, commonAxis, clearance: Math.max(45, width * 0.4), pathVerified: false };
    r.detachedTranslation = direction.map(v => -v * r.installation.clearance);
    const detachable = preassemble && (commonAxis || r.kind === 'slide');
    const bodyModule = r.kind === 'body' && marks.length > 0 && commonAxis;
    if (preassemble && !commonAxis && r.kind === 'roof') diagnostics.push({ code: 'INCOMPATIBLE_INTERFACE_AXES', severity: 'error', message: '预装模块的接口无法沿同一方向插接，请将边界框架纳入模块或调整区域。', nodeIds: marks.map(m => m.nodeId).filter(Boolean), partIds: r.partIds });
    if (preassemble && !commonAxis && r.kind === 'ramp') { r.installation.mode = 'in-place'; r.installation.pathVerified = true; }
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
    if (detachable || r.kind === 'roof') {
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
        if (nodeIds.length || frame.length || clampIds.length) {
          const s = createStep(r, { nodeIds, tubeIds: frame.map(t => t.id), clampIds }, buildAction, copy(`${r.name}：${Math.round(y)} cm 框架`, `${r.name}: frame at ${Math.round(y)} cm`, `${r.name}: Rahmen auf ${Math.round(y)} cm`)); s.y = y; s.kind = 'frame';
        }
        if (risers.length) { const s = createStep(r, { tubeIds: risers.map(t => t.id) }, buildAction, copy(`${r.name}：向上安装立柱`, `${r.name}: install uprights`, `${r.name}: Stützen einsetzen`)); s.y = y; s.kind = 'risers'; }
      }
      const accessories = Object.fromEntries(['panelIds', 'textileIds', 'slideIds', 'fittingIds'].map(k => [k, keys[k]]));
      if (Object.values(accessories).some(ids => ids.length)) { const s = createStep(r, accessories, buildAction, copy(`固定 ${r.name} 面板与配件`, `Fit panels and accessories of ${r.name}`, `Platten und Zubehör von ${r.name} befestigen`)); s.kind = 'panels'; }
      if (bodyModule) createStep(r, keys, { type: 'attach', translation: [0, 0, 0], detached: false }, copy(`拼接 ${r.name}`, `Join ${r.name}`, `${r.name} verbinden`));
    }
    if (r.tubeIds.some(id => { const t = model.tubes.get(id); return !t.arm && !t.link; }) || r.panelIds.length || r.slideIds.length) createStep(r, {}, { type: 'fix', translation: [0, 0, 0], references: r.partIds, inspection: true }, copy(`${r.name}：固定并检查螺丝位置`, `${r.name}: secure and check screw positions`, `${r.name}: Schraubstellen sichern und prüfen`));
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
    const supportSteps = steps.filter(s => s.regionId === support?.id && s.kind !== 'accessories');
    if (supportSteps.length && steps.indexOf(supportSteps.at(-1)) >= steps.indexOf(step) && step.action.type !== 'preassemble') diagnostics.push({ code: 'INVALID_ASSEMBLY_ORDER', severity: 'error', message: '接口支撑区域尚未完成，请调整区域顺序。', nodeIds: mark.nodeId ? [mark.nodeId] : [], partIds: [] });
  }
  const bom = computeBOM(model), ledger = allocateBOM(model, bom, steps, owner, diagnostics);
  const fixingPoints = [];
  for (const row of bom.screws) for (const allocation of row.allocations || []) {
    const regionId = partRegion.get(allocation.partId), step = steps.find(s => s.regionId === regionId && s.action.type === 'fix');
    const positions = allocation.positions || [];
    if (!positions.length) {
      diagnostics.push({ code: 'FIXING_POSITION_UNRESOLVED', severity: 'error', message: '标准螺丝缺少可核对的安装位置。', nodeIds: [], partIds: [allocation.partId] });
      continue;
    }
    const perPoint = allocation.count / positions.length;
    for (const position of positions) fixingPoints.push({ id: `fixing-${fixingPoints.length + 1}`, partId: allocation.partId, regionId, stepId: step?.id || steps[owner.get(allocation.partId)]?.id, position: [...position], screwId: row.id, count: perPoint, precision: allocation.precision, installationType: row.id, holePositionVerified: false });
  }
  for (const step of steps) {
    step.fixingPointIds = fixingPoints.filter(p => p.stepId === step.id).map(p => p.id);
    if (step.action.type === 'fix') step.action.references = [...new Set(fixingPoints.filter(p => p.stepId === step.id).map(p => p.partId))];
  }
  for (const step of steps) for (const group of GROUPS) step[group] = step.parts[group];
  for (const [name] of Object.entries(MAPS)) for (const p of values(model, MAPS[name])) if (!owner.has(p.id)) diagnostics.push({ code: 'PART_UNASSIGNED', severity: 'error', message: `部件 ${p.id} 没有区域或装配步骤。`, nodeIds: MAPS[name] === 'nodes' ? [p.id] : [], partIds: [p.id] });
  return { version: 1, order, regions, interfaces, fixingPoints, steps, diagnostics, bom, ledger, canExport: ledger.conserved && !diagnostics.some(d => d.severity === 'error'), levels };
}

/** 渲染器只消费此快照。已预装模块保持分离，直到安装步骤才归位。 */
export function assemblyState(plan, index, { action = false } = {}) {
  const done = new Set(), current = new Set(), visible = new Set(), transforms = new Map(), arrows = [];
  const end = Math.min(Math.max(-1, index), plan.steps.length - 1);
  const detached = new Map();
  for (let i = 0; i <= end; i++) {
    const step = plan.steps[i];
    if (step.action?.type === 'preassemble') detached.set(step.regionId, step.action.translation);
    if (step.action?.type === 'attach') detached.delete(step.regionId);
    for (const id of step.partIds || idsOf(step)) {
      visible.add(id);
      if (i === end) current.add(id); else done.add(id);
    }
  }
  for (const id of current) done.delete(id);
  for (const [regionId, translation] of detached) for (const id of plan.regions.find(r => r.id === regionId)?.partIds || []) if (visible.has(id)) transforms.set(id, translation);
  const step = plan.steps[end];
  if (step?.action?.type === 'fix') for (const id of step.action.references || []) if (visible.has(id)) { current.add(id); done.delete(id); }
  const interfaceMarks = (step?.interfaceIds || []).map(id => plan.interfaces.find(a => a.id === id)).filter(Boolean);
  if (action && step?.action?.type === 'attach') {
    const region = plan.regions.find(r => r.id === step.regionId), translation = region?.detachedTranslation || [0, 30, 0];
    for (const id of region?.partIds || []) if (visible.has(id)) transforms.set(id, translation);
    // 动作帧保持模块分离，完成帧移回最终位置。
    for (const mark of interfaceMarks) arrows.push({ id: mark.id, from: mark.position.map((v, i) => v + translation[i]), to: mark.position, direction: norm(translation.map(v => -v)), regionId: step.regionId });
  }
  return { done, current, visible, transforms, arrows, interfaceMarks, fixingPoints: (plan.fixingPoints || []).filter(p => p.stepId === step?.id) };
}
