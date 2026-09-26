// 方向键接管从哪个接头出发。候选接头按顺序排好（越靠前越优先），
// 挑沿 dir 最靠前的那个；一样靠前时先挑 dir 那一侧还空着的，再按候选顺序。
// armFree(node, dir) 说这个接头往 dir 还能不能插管。

// 沿方向差这么多以内算一样靠前（cm）
const TIE = 0.5;

export function pickStepAnchor(model, candidateIds, dir, armFree) {
  let best = null;
  let bestAlong = -Infinity;
  let bestFree = false;
  for (const id of candidateIds) {
    const n = model.nodes.get(id);
    if (!n) continue;
    const along = n.x * dir[0] + n.y * dir[1] + n.z * dir[2];
    const free = armFree(n, dir);
    const ahead = along > bestAlong + TIE;
    const tie = Math.abs(along - bestAlong) <= TIE;
    if (ahead || (tie && free && !bestFree)) {
      best = n;
      bestAlong = along;
      bestFree = free;
    }
  }
  return best;
}

// 候选接头：点选的接头优先，其次 stepFrom；都没有而造型只有一个接头或一根管时，
// 就从它的两头挑。返回空数组表示不知道从哪接。
export function stepCandidates(model, selectedNodeId, stepFrom) {
  if (selectedNodeId && model.nodes.has(selectedNodeId)) return [selectedNodeId];
  const from = stepFrom.filter((id) => model.nodes.has(id));
  if (from.length) return from;
  const tubes = [...model.tubes.values()].filter((t) => !t.link);
  const nodes = [...model.nodes.values()].filter((n) => !n.unused && !n.c45body);
  if (tubes.length === 0 && nodes.length === 1) return [nodes[0].id];
  if (tubes.length === 1 && nodes.length === 2) return [tubes[0].b, tubes[0].a];
  return [];
}

// 选择模式里选中的东西换成方向键的候选接头：选中的接头本身，选中的管子取两头。
export function stepCandidatesFromSelection(model, selection) {
  const ids = [];
  const push = (id) => { if (id != null && !ids.includes(id)) ids.push(id); };
  for (const [id, kind] of selection) {
    if (kind === "node") push(id);
    else if (kind === "tube") {
      const t = model.tubes.get(id);
      if (t && !t.link) { push(t.b); push(t.a); }
    }
  }
  return ids.filter((id) => {
    const n = model.nodes.get(id);
    return n && !n.unused && !n.c45body;
  });
}
