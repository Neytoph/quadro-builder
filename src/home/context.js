const number = n => typeof n === 'number' && Number.isFinite(n);
const vector = v => Array.isArray(v) && v.length === 3 && v.every(number);
export function validHomeContext(c) {
  if (!c || c.version !== 1 || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 160 || !(c.roomId === null || typeof c.roomId === 'string' && c.roomId.length <= 80) || !Number.isInteger(c.roomRev) || c.roomRev < 0) return false;
  const s = c.snapshot, r = s?.room;
  if (!r || !['furniture', 'area'].includes(s.mode) || ![r.w, r.h, r.d].every(n => number(n) && n > 0 && n <= 2000) || !Array.isArray(s.items) || s.items.length > 61) return false;
  const ids = new Set(), counts = { furniture: 0, reserved: 0, usable: 0 };
  if (s.openings !== undefined && (!Array.isArray(s.openings) || s.openings.length > 20)) return false;
  for (const o of (s.openings || [])) {
    if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 80 || ids.has(o.id) || !['window', 'door'].includes(o.kind) || !['back', 'front', 'left', 'right'].includes(o.wall)) return false;
    ids.add(o.id);
    const length = ['back', 'front'].includes(o.wall) ? r.w : r.d;
    if (![o.offset, o.width, o.height, o.elevation].every(Number.isInteger) || o.offset < 0 || o.width < 1 || o.height < 1 || o.elevation < 0 || o.offset + o.width > length || o.elevation + o.height > r.h || o.kind === 'door' && o.elevation !== 0) return false;
  }
  for (const i of s.items) {
    if (!i || typeof i.id !== 'string' || !i.id || i.id.length > 80 || ids.has(i.id) || typeof i.name !== 'string' || i.name.length > 160) return false;
    ids.add(i.id);
    if (i.rotation !== undefined && ![0, 90, 180, 270].includes(i.rotation)) return false;
    if (!Object.hasOwn(counts, i.kind)) return false;
    counts[i.kind]++;
    if (i.kind === 'furniture' ? !['sofa', 'cabinet', 'bed', 'table', 'column', 'other'].includes(i.type) : i.type !== i.kind) return false;
    if (![i.x, i.elevation, i.z].every(n => number(n) && n >= 0) || ![i.w, i.h, i.d].every(n => number(n) && n > 0)) return false;
    if (i.x + i.w > r.w + .001 || i.elevation + i.h > r.h + .001 || i.z + i.d > r.d + .001 || i.kind === 'usable' && (i.elevation !== 0 || i.h !== r.h)) return false;
  }
  if (counts.furniture > 30 || counts.reserved > 30 || counts.usable > 1) return false;
  const p = c.placement;
  return p == null || vector(p.position) && vector(p.pivot) && [...p.position, ...p.pivot].every(n => Math.abs(n) < 100000) && number(p.rotation) && Math.abs(p.rotation) <= 360;
}

export function placeInRoom(record, bounds) {
  const r = record.data.room, min = bounds?.min || [0, 0, 0], max = bounds?.max || min;
  const pivot = min.map((n, a) => a === 1 ? n : (n + max[a]) / 2);
  return { version: 1, roomId: record.id, roomRev: record.rev, name: record.name, snapshot: structuredClone(record.data), placement: { position: [r.w / 2, 0, r.d / 2], pivot, rotation: 0 } };
}
