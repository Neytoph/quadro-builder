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
