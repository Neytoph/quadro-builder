// 放板时几块候选面叠在一起（从盒子开口望进去：前面那块、底下那格、对面那块
// 都在指针底下），射线先碰到的是最前面那块，但人点的往往是底下那格。
// 规矩：点到了哪块的圆点就是哪块；没点到圆点，看指针离哪块的中心最近。
// 纯函数，场景和测试都用它。

/**
 * @param hits    指针下的手柄命中，由近到远；每项 { object:{ userData, position } }
 * @param sx,sy   指针的屏幕坐标
 * @param toScreen 把世界坐标点投到屏幕：(position) => [x, y]
 * @returns 该算数的那一个命中（没有候选面就是 hits[0]）
 */
export function preferPanelCell(hits, sx, sy, toScreen) {
  if (!hits || !hits.length) return null;
  const cells = hits.filter((h) => h.object && h.object.userData && h.object.userData.panelCell);
  if (cells.length < 2) return hits[0];
  const dot = cells.find((h) => h.object.userData.panelDot);
  if (dot) return dot;
  let best = null;
  let bestD = Infinity;
  for (const h of cells) {
    const p = toScreen(h.object.position);
    if (!p) continue;
    const d = Math.hypot(p[0] - sx, p[1] - sy);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best || hits[0];
}

/** 重叠的方向拾取区按可见线段的屏幕距离排序，悬停和点击共用。 */
export function preferGuideHandle(hits, sx, sy, toScreen) {
  if (!hits.length) return null;
  if (!hits[0].object.userData.arrowRoot) return hits[0];
  const candidates = [];
  const roots = new Set();
  for (const hit of hits) {
    const root = hit.object.userData.arrowRoot;
    if (!root || root.visible === false || roots.has(root)) continue;
    roots.add(root);
    const segment = root.userData.guideSegment;
    if (!segment) continue;
    const a = toScreen(segment[0]), b = toScreen(segment[1]);
    if (!a || !b) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], lengthSq = dx * dx + dy * dy;
    // 正对镜头而缩成一个点的方向不抢走其他线段的点击。
    if (lengthSq < 4) continue;
    const along = Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / lengthSq));
    const distance = Math.hypot(sx - a[0] - along * dx, sy - a[1] - along * dy);
    candidates.push({ hit, distance, originDistance: Math.hypot(sx - a[0], sy - a[1]) });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.hit.distance - b.hit.distance);
  const best = candidates[0];
  if (!best) return null;
  // 多条线的公共根部无法区分方向时，不安装到另一个方向。
  if (best.originDistance < 3 && candidates[1]?.originDistance < 3
      && candidates[1].distance - best.distance < 0.5) return null;
  return best.hit;
}
