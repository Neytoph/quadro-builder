// 只合并同一直线、实际相接或重叠的线段；相邻双管的平行插口仍各自保留。
export function mergeTubeGuideSegments(segments) {
  const lines = new Map();
  for (const segment of segments) {
    const delta = segment.end.map((v, i) => v - segment.start[i]);
    const length = Math.hypot(...delta);
    if (length < 1e-6) continue;
    let dir = delta.map(v => v / length);
    const largest = dir.reduce((a, _, i) => Math.abs(dir[i]) > Math.abs(dir[a]) ? i : a, 0);
    if (dir[largest] < 0) dir = dir.map(v => -v);
    const dot = point => point.reduce((sum, v, i) => sum + v * dir[i], 0);
    const start = dot(segment.start), end = dot(segment.end);
    const origin = segment.start.map((v, i) => v - start * dir[i]);
    const key = [...dir, ...origin].map(v => Math.round(v * 1000)).join(',');
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ lo: Math.min(start, end), hi: Math.max(start, end), dir, origin, sources: [segment] });
  }
  const result = [];
  for (const intervals of lines.values()) {
    intervals.sort((a, b) => a.lo - b.lo);
    let current = null;
    for (const interval of intervals) {
      if (current && interval.lo <= current.hi + .001) {
        current.hi = Math.max(current.hi, interval.hi);
        current.sources.push(...interval.sources);
      } else {
        current = { ...interval, sources: interval.sources.slice() };
        result.push(current);
      }
    }
  }
  return result.map(({ lo, hi, dir, origin, sources }) => ({
    start: origin.map((v, i) => v + lo * dir[i]),
    end: origin.map((v, i) => v + hi * dir[i]), sources,
  }));
}
