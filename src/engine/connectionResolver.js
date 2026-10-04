import { BuildModel } from './model.js';
import { computeBOM, resolveNodeConnection } from './bom.js';
import { C45_SLEEVE_LEN, C45_ARM_LEN, DIRECTIONS } from './config.js';

export { resolveNodeConnection } from './bom.js';
const norm = d => { const l = Math.hypot(...d) || 1; return d.map(v => v / l); };
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const diagnosticsOf = model => [...model.nodes.values()].flatMap(n => resolveNodeConnection(model, n).diagnostics);

function reachableFromGround(model) {
  const neighbors = new Map([...model.nodes.keys()].map(id => [id, new Set()]));
  const connect = (a, b) => { neighbors.get(a)?.add(b); neighbors.get(b)?.add(a); };
  for (const tube of model.tubes.values()) connect(tube.a, tube.b);
  for (const node of model.nodes.values()) if (node.clampOn) {
    const tube = model.tubes.get(node.clampOn.tubeId);
    if (tube) { connect(node.id, tube.a); connect(node.id, tube.b); }
  }
  for (const c of model.clamps.values()) {
    const a = model._clampBaseTube(c), b = model._clampSecondTube(c);
    if (a && b) connect(a.a, b.a);
  }
  const grounded = [...model.nodes.values()].filter(n => n.y <= 0.6).map(n => n.id);
  const found = new Set(grounded);
  for (let i = 0; i < grounded.length; i++) for (const id of neighbors.get(grounded[i]) || []) if (!found.has(id)) { found.add(id); grounded.push(id); }
  return found;
}

function dependencyErrors(model) {
  const out = [];
  const add = (partId, message) => out.push({ code: 'REPAIR_INVALID_DEPENDENCY', severity: 'error', partIds: [partId], nodeIds: [], message });
  for (const tube of model.tubes.values()) if (!model.nodes.has(tube.a) || !model.nodes.has(tube.b)) add(tube.id, '修正导致管件端点不存在。');
  for (const p of [...model.panels.values(), ...model.textiles.values(), ...model.fittings.values()]) {
    const refs = p.supportTubes || [p.tube, p.a, p.b].filter(id => typeof id === 'string' && id.startsWith('t'));
    if (refs.some(id => !model.tubes.has(id))) add(p.id, '修正导致板材、布面或配件失去安装管件。');
  }
  for (const n of model.nodes.values()) if (n.clampOn && !model.tubes.has(n.clampOn.tubeId)) add(n.id, '修正导致夹具失去支撑管件。');
  for (const c of model.clamps.values()) if (!model._clampBaseTube(c)) add(c.id, '修正导致双管夹具失去基管。');
  return out;
}

/** 只返回完整可审阅快照，调用者须经用户确认后 apply。不会改写 live model。
 * @param {BuildModel} model
 * @param {string[] | null} nodeIds
 */
export function proposeAssemblyRepairs(model, nodeIds = null) {
  const original = model.toJSON(), candidate = new BuildModel();
  if (!candidate.loadJSON(original).ok) throw new Error('装配修正无法载入模型快照。');
  const before = diagnosticsOf(model), selected = new Set(nodeIds || before.flatMap(d => d.nodeIds));
  const changes = [], blocked = [], originallyGrounded = reachableFromGround(model);
  const reject = (id, message) => blocked.push({ code: 'REPAIR_BLOCKED', severity: 'error', message, suggestion: '选择冲突管件并检查其位置与支撑依赖。', nodeIds: [id], partIds: [id] });
  for (const id of selected) {
    const node = candidate.nodes.get(id);
    if (!node) { reject(id, '指定的连接件不存在。'); continue; }
    const resolution = resolveNodeConnection(candidate, node);
    if (resolution.diagnostics.some(d => d.code === 'DUPLICATE_CONNECTOR_PORT')) {
      const attached = [...candidate.tubes.values()].filter(t => t.a === id || t.b === id);
      const bows = attached.filter(t => t.bow);
      const conflicting = attached.filter(t => !t.bow && !t.arm && !t.link && bows.some(bow => {
        const other = candidate.nodes.get(t.a === id ? t.b : t.a), bowOther = candidate.nodes.get(bow.a === id ? bow.b : bow.a);
        return dot(norm(candidate._tubeDirAt(t, node, other)), norm(candidate._tubeDirAt(bow, node, bowOther))) > 0.99;
      }));
      // 仅提出删除被弯管重复占用的短立柱，完整依赖与连通性检查在全部修改后执行。
      if (conflicting.length !== 1 || conflicting[0].tubeId !== 'T15') { reject(id, '同端口冲突无法可靠地通过移除短立柱修正。'); continue; }
      const tube = conflicting[0], other = candidate.nodes.get(tube.a === id ? tube.b : tube.a);
      if (other.y <= node.y || Math.abs(other.x - node.x) > 0.6 || Math.abs(other.z - node.z) > 0.6 || candidate.degree(other.id) < 3) { reject(id, '冲突立柱的另一端缺少可核对的框架支撑。'); continue; }
      candidate.tubes.delete(tube.id);
      changes.push({ type: 'remove-conflicting-riser', action: 'remove', nodeId: id, tubeId: tube.id, partId: tube.id, catalogPartId: tube.tubeId, before: { ...tube }, after: null, reason: '弯管切线与短立柱共用同一端口；上端框架仍连接其他支撑。' });
    } else if (resolution.diagnostics.some(d => d.code === 'MISSING_C45_ADAPTER')) {
      const diagonals = [...candidate.tubes.values()].filter(t => !t.arm && !t.link && !t.bow && (t.a === id || t.b === id)).filter(t => {
        const other = candidate.nodes.get(t.a === id ? t.b : t.a), d = norm(candidate._tubeDirAt(t, node, other));
        const a = d.map(Math.abs).sort((x, y) => y - x);
        return a[1] > 0.5 && a[0] - a[1] < 0.2 && a[2] < 0.2;
      });
      if (diagonals.length !== 1) { reject(id, '多个斜管的几何修正需要分别核对。'); continue; }
      const tube = diagonals[0], other = candidate.nodes.get(tube.a === id ? tube.b : tube.a);
      if (candidate.degree(other.id) !== 1 || [...candidate.panels.values(), ...candidate.textiles.values(), ...candidate.fittings.values()].some(p => (p.supportTubes || [p.tube, p.a, p.b]).includes(tube.id))) { reject(id, '斜管另一端连接了框架或面板，需要调整完整模块后再确认。'); continue; }
      const direction = norm(candidate._tubeDirAt(tube, node, other));
      const axis = DIRECTIONS.map(d => d.vec).filter(a => !resolution.worldDirs.some(d => dot(a, d) > 0.99)).sort((a, b) => dot(b, direction) - dot(a, direction))[0];
      if (!axis) { reject(id, '基座连接件没有空闲端口可安装 C45。'); continue; }
      const old = { a: tube.a, b: tube.b }, result = candidate.addC45Adapter(id, axis, direction, C45_SLEEVE_LEN, C45_ARM_LEN);
      if (!result?.body) { reject(id, 'C45 适配器的真实安装位置低于地面或不可用。'); continue; }
      const body = result.body, translation = [body.x - node.x, body.y - node.y, body.z - node.z];
      other.x += translation[0]; other.y += translation[1]; other.z += translation[2];
      if (tube.a === id) tube.a = body.id; else tube.b = body.id;
      delete tube.geom;
      const arm = [...candidate.tubes.values()].find(t => t.arm && (t.a === body.id || t.b === body.id));
      changes.push({ type: 'add-c45-adapter', nodeId: id, tubeId: tube.id, bodyId: body.id, armId: arm?.id, axis, direction, translation, before: old, after: { a: tube.a, b: tube.b } });
    }
  }
  const after = diagnosticsOf(candidate), nowGrounded = reachableFromGround(candidate);
  const validation = dependencyErrors(candidate);
  for (const id of originallyGrounded) if (candidate.nodes.has(id) && !nowGrounded.has(id)) validation.push({ code: 'REPAIR_LOST_GROUND_CONNECTION', severity: 'error', message: '修正后原有框架失去地面连接。', nodeIds: [id], partIds: [id] });
  for (const n of candidate.nodes.values()) if (n.y < -0.6) validation.push({ code: 'REPAIR_BELOW_GROUND', severity: 'error', message: '修正后部件低于地面。', nodeIds: [n.id], partIds: [n.id] });
  const oldKeys = new Set(before.map(d => `${d.code}:${d.nodeIds.join(',')}`));
  const newErrors = after.filter(d => !oldKeys.has(`${d.code}:${d.nodeIds.join(',')}`));
  const unresolved = after.filter(d => d.nodeIds.some(id => selected.has(id)));
  const canApply = changes.length > 0 && !blocked.length && !validation.length && !newErrors.length && !unresolved.length;
  const beforeBOM = computeBOM(model), afterBOM = computeBOM(candidate), bomChanges = [];
  for (const group of ['tubes', 'connectors', 'panels', 'fittings', 'textiles', 'slides', 'reinforcements']) {
    const keyOf = r => r.key || r.type || r.id, keys = new Set([...beforeBOM[group], ...afterBOM[group]].map(keyOf));
    for (const key of keys) {
      const from = beforeBOM[group].find(r => keyOf(r) === key)?.count || 0, to = afterBOM[group].find(r => keyOf(r) === key)?.count || 0;
      if (from !== to) bomChanges.push({ group, key, before: from, after: to, delta: to - from });
    }
  }
  const data = canApply ? candidate.toJSON() : null;
  if (data && model.assemblyConfig) {
    data.assemblyConfig = structuredClone(model.assemblyConfig);
    if (data.assemblyConfig.regions) {
      for (const r of data.assemblyConfig.regions) r.partIds = r.partIds.filter(id => !changes.some(c => c.after === null && c.tubeId === id));
      data.assemblyConfig.regions = data.assemblyConfig.regions.filter(r => r.partIds.length);
      if (data.assemblyConfig.order) data.assemblyConfig.order = data.assemblyConfig.order.filter(id => data.assemblyConfig.regions.some(r => r.id === id));
    }
  }
  return { data, diagnostics: [...blocked, ...validation, ...newErrors, ...unresolved], remainingDiagnostics: after, changes, bomChanges, canApply, canExport: canApply && after.length === 0, validation: { dependencies: validation.length === 0, groundConnectivity: [...originallyGrounded].every(id => !candidate.nodes.has(id) || nowGrounded.has(id)), loadVerified: false }, beforeBOM, afterBOM };
}
