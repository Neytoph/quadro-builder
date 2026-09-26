// 按拼装步骤出 A4 横版 PDF：封面（正/反 + 总料表）+ 一步一页（正/反两图）。
// 整页先画在 2D Canvas 再压成 JPEG，避免给 jsPDF 嵌 CJK 字体。
// 料表用「圆圈编号 + 图标 + 名称」；图上只标对应数字，不再往 3D 模型上写字。

import { jsPDF } from "jspdf";
import {
  partForFitting, partName, slideKindName, geometry, colorHex, colorName,
  reinforcementPart, poolLinerFor,
} from "./catalog.js";
import { connectorsForNode, textileRow } from "./bom.js";
import { POOL_KINDS } from "./model.js";
import { partIcon } from "../ui/icons";
import { drawQr } from "../sharePage";

const PAGE_W = 297;
const PAGE_H = 210;
const PX = 10;
const CW = PAGE_W * PX;
const CH = PAGE_H * PX;
const PAPER = "#f3eadc";
const INK = "#1f2430";
const MUTED = "#5c6570";
const WELL = "#edd8c4";
const ACCENT = "#ea580c";
const M = 7;
const SNAP_LONG = 2000;
const FIT = 1.05;
const MARK_PULL = 8;

function mm(n) { return n * PX; }

function font(weight, px) {
  return `${weight} ${px}px "PingFang SC","Hiragino Sans GB","Noto Sans SC","Source Han Sans SC","Microsoft YaHei","Segoe UI",sans-serif`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) { reject(new Error("empty snapshot")); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load"));
    img.src = url;
  });
}

function stepBox() {
  const gap = 2.5;
  const headerH = 11;
  const partsH = 24;
  const imgY = headerH;
  const imgH = PAGE_H - imgY - partsH - 3;
  const imgW = (PAGE_W - M * 2 - gap) / 2;
  return { gap, headerH, partsH, imgY, imgH, imgW, x0: M, x1: M + imgW + gap };
}

function coverBox() {
  const gap = 2.5;
  const headerH = 16;
  const bomH = 54;
  const imgY = headerH;
  const imgH = PAGE_H - imgY - bomH - 3;
  const imgW = (PAGE_W - M * 2 - gap) / 2;
  return { gap, headerH, bomH, imgY, imgH, imgW, x0: M, x1: M + imgW + gap };
}

function snapSize(imgW, imgH) {
  const a = imgW / imgH;
  if (a >= 1) return { width: SNAP_LONG, height: Math.max(1, Math.round(SNAP_LONG / a)) };
  return { width: Math.max(1, Math.round(SNAP_LONG * a)), height: SNAP_LONG };
}

function drawShot(ctx, img, x, y, w, h, fill) {
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2));
  ctx.clip();
  ctx.fillStyle = fill || WELL;
  ctx.fillRect(x, y, w, h);
  if (img && img.width) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

function paintCaption(ctx, text, x, y, h) {
  ctx.font = font(600, mm(3));
  const tw = ctx.measureText(text).width;
  const pad = mm(1.4);
  const bh = mm(5);
  const bx = x + mm(2);
  const by = y + h - bh - mm(2);
  ctx.fillStyle = "rgba(31,36,48,0.72)";
  roundRect(ctx, bx, by, tw + pad * 2, bh, mm(1));
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + pad, by + bh / 2);
  ctx.textBaseline = "top";
}

function drawBadge(ctx, x, y, num, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fill();
  ctx.lineWidth = Math.max(0.7, r * 0.12);
  ctx.strokeStyle = "rgba(92,101,112,0.55)";
  ctx.stroke();
  const s = String(num);
  ctx.fillStyle = MUTED;
  ctx.font = font(500, s.length > 1 ? r * 1.02 : r * 1.18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y + r * 0.04);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

function separateMarks(marks, minD) {
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < marks.length; i++) {
      for (let j = 0; j < i; j++) {
        let dx = marks[i].x - marks[j].x;
        let dy = marks[i].y - marks[j].y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 0.2) {
          dx = 0.7;
          dy = -0.7;
          d = 1;
        }
        const push = (minD - d) / 2;
        const ux = dx / d, uy = dy / d;
        marks[i].x += ux * push;
        marks[i].y += uy * push;
        marks[j].x -= ux * push;
        marks[j].y -= uy * push;
      }
    }
  }
}

function drawMarks(ctx, img, x, y, w, h, marks) {
  if (!img || !img.width || !marks || !marks.length) return;
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  const ox = x + (w - dw) / 2;
  const oy = y + (h - dh) / 2;
  const r = mm(1.65);
  const placed = marks.map((m) => ({
    num: m.num,
    x: ox + m.u * dw,
    y: oy + m.v * dh,
    z: m.z,
  })).filter((m) => m.x > x - r && m.x < x + w + r && m.y > y - r && m.y < y + h + r);
  placed.sort((a, b) => a.z - b.z);
  separateMarks(placed, r * 2.15);
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2));
  ctx.clip();
  for (const m of placed) drawBadge(ctx, m.x, m.y, m.num, r);
  ctx.restore();
}

function paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks) {
  const { x0, x1, imgY, imgW, imgH } = box;
  drawShot(ctx, front, mm(x0), mm(imgY), mm(imgW), mm(imgH), fill);
  drawShot(ctx, back, mm(x1), mm(imgY), mm(imgW), mm(imgH), fill);
  paintCaption(ctx, copy.front, mm(x0), mm(imgY), mm(imgH));
  paintCaption(ctx, copy.back, mm(x1), mm(imgY), mm(imgH));
  drawMarks(ctx, front, mm(x0), mm(imgY), mm(imgW), mm(imgH), frontMarks);
  drawMarks(ctx, back, mm(x1), mm(imgY), mm(imgW), mm(imgH), backMarks);
}

function sceneFill(scene) {
  const bg = scene.scene?.background;
  if (bg && typeof bg.getHexString === "function") return `#${bg.getHexString()}`;
  return WELL;
}

function ellipsize(ctx, text, maxW) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  let cur = s;
  while (cur.length && ctx.measureText(`${cur}…`).width > maxW) cur = cur.slice(0, -1);
  return `${cur}…`;
}

function visibleBounds(model, builder) {
  const pad = geometry().connectorSize / 2;
  const vis = builder._assemblyVisibility?.();
  if (!vis) return model.bounds(pad);
  const ids = new Set();
  for (const id of vis.done) ids.add(id);
  for (const id of vis.current) ids.add(id);
  return model.boundsOf(ids, pad);
}

function facingXZ(world, cam, target, slack = 2) {
  const fx = cam.x - target.x;
  const fz = cam.z - target.z;
  const px = world[0] - target.x;
  const pz = world[2] - target.z;
  return px * fx + pz * fz >= -slack;
}

function towardCam(world, cam, dist) {
  const dx = cam.x - world[0];
  const dy = cam.y - world[1];
  const dz = cam.z - world[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    world[0] + (dx / len) * dist,
    world[1] + (dy / len) * dist + 2.4,
    world[2] + (dz / len) * dist,
  ];
}

function dist2(world, cam) {
  const dx = cam.x - world[0], dy = cam.y - world[1], dz = cam.z - world[2];
  return dx * dx + dy * dy + dz * dz;
}

function centroid(pts) {
  if (!pts || !pts.length) return null;
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = pts.length;
  return [x / n, y / n, z / n];
}

function tubeMid(model, t) {
  const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
  if (!a || !b) return null;
  return [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
}

function pushPos(map, key, world) {
  if (!key || !world) return;
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(world);
}

function allowId(set, id) {
  return !set || set.has(id);
}

/** @param {ReturnType<typeof stepFilter> | null} [filter] 只收这一步的件；null 收全部 */
export function collectPositions(model, filter = null) {
  const map = new Map();
  const nodes = filter?.nodes || null;
  const tubes = filter?.tubes || null;
  const panels = filter?.panels || null;
  const textiles = filter?.textiles || null;
  const slides = filter?.slides || null;
  const fittings = filter?.fittings || null;
  const all = !filter;

  for (const n of model.nodes.values()) {
    if (n.unused) continue;
    if (!allowId(nodes, n.id) && !all) continue;
    if (all || nodes) {
      for (const type of connectorsForNode(model, n)) {
        pushPos(map, `connectors:${type}`, [n.x, n.y, n.z]);
      }
    }
  }

  if (all && model.clamps) {
    for (const c of model.clamps.values()) {
      const type = c.connectorId || "double_tube";
      pushPos(map, `connectors:${type}`, [c.x, c.y, c.z]);
    }
  }

  const reinf = reinforcementPart();
  for (const t of model.tubes.values()) {
    if (t.arm || t.link) continue;
    if (!allowId(tubes, t.id) && !all) continue;
    if (!(all || tubes)) continue;
    const mid = tubeMid(model, t);
    pushPos(map, `${t.tubeId}|${t.color}`, mid);
    if (t.reinforced && reinf) pushPos(map, `reinforcements:${reinf.id}`, mid);
  }

  for (const p of model.panels.values()) {
    if (p.poolPart) continue;
    if (!allowId(panels, p.id) && !all) continue;
    if (!(all || panels)) continue;
    const cor = model.panelCorners(p);
    pushPos(map, `${p.panelId}|${p.color}`, centroid(cor));
  }

  for (const tx of (model.textiles ? model.textiles.values() : [])) {
    if (!allowId(textiles, tx.id) && !all) continue;
    if (!(all || textiles)) continue;
    const cor = model.panelCorners(tx);
    pushPos(map, textileRow(model, tx).key, centroid(cor));
  }

  for (const sl of (model.slides ? model.slides.values() : [])) {
    if (!allowId(slides, sl.id) && !all) continue;
    if (!(all || slides)) continue;
    const def = partForFitting(sl.kind);
    const sid = (def && def.id) || sl.kind;
    pushPos(map, `slides:${sid}`, [sl.x, sl.y, sl.z]);
  }

  for (const f of (model.fittings ? model.fittings.values() : [])) {
    if (f.kind === "open-connector2") continue;
    if (!allowId(fittings, f.id) && !all) continue;
    if (!(all || fittings)) continue;
    const world = [f.x, f.y, f.z];
    if (POOL_KINDS.has(f.kind)) {
      const def = poolLinerFor(Math.abs(f.w || 0), Math.abs(f.d || 0));
      if (def) pushPos(map, `fittings:${def.id}`, world);
      continue;
    }
    const def = partForFitting(f.kind, f.mask);
    const fid = def ? def.id : f.kind;
    pushPos(map, `fittings:${fid}`, world);
  }

  return map;
}

function niceName(r) {
  const n = r && r.name && r.name !== "undefined" ? String(r.name) : "";
  if (n) return n;
  if (r && r.w && r.h) return `${r.w}×${r.h}`;
  return String(r?.id || r?.key || "");
}

function itemCaption(it) {
  return it.name || "";
}

function numberItems(rows) {
  return rows.filter((r) => r && r.count > 0 && r.name).map((r, i) => ({ ...r, num: i + 1 }));
}

export function coverItems(bom) {
  if (!bom) return [];
  const rows = [];
  const take = (list) => {
    for (const r of list || []) {
      rows.push({
        key: r.key,
        id: r.id,
        kind: r.kind,
        name: niceName(r),
        color: r.color || null,
        colorName: r.colorName || null,
        count: r.count,
      });
    }
  };
  take(bom.tubes);
  take(bom.connectors);
  take(bom.panels);
  take(bom.textiles);
  take(bom.slides);
  take(bom.wheels);
  take(bom.fittings);
  take(bom.reinforcements);
  take(bom.screws);
  return numberItems(rows);
}

function bump(map, key, seed) {
  let row = map.get(key);
  if (!row) {
    row = { ...seed, count: 0 };
    map.set(key, row);
  }
  row.count += 1;
}

function extraStepItems(model, step) {
  const map = new Map();
  for (const id of step.slideIds || []) {
    const sl = model.slides?.get?.(id);
    if (!sl) continue;
    const def = partForFitting(sl.kind);
    const sid = (def && def.id) || sl.kind;
    bump(map, `slides:${sid}`, {
      key: `slides:${sid}`, id: sid, kind: "slides",
      name: def ? partName(def) : (slideKindName(sl.kind) || sl.kind),
    });
  }
  for (const id of step.fittingIds || []) {
    const f = model.fittings?.get?.(id);
    if (!f || f.kind === "open-connector2") continue;
    if (POOL_KINDS.has(f.kind)) {
      const def = poolLinerFor(Math.abs(f.w || 0), Math.abs(f.d || 0));
      const fid = def ? def.id : f.kind;
      bump(map, `fittings:${fid}`, {
        key: `fittings:${fid}`, id: fid, kind: "fittings",
        name: def ? partName(def) : f.kind,
      });
      continue;
    }
    const def = partForFitting(f.kind, f.mask);
    const fid = def ? def.id : f.kind;
    bump(map, `fittings:${fid}`, {
      key: `fittings:${fid}`, id: fid, kind: "fittings",
      name: def ? partName(def) : f.kind,
    });
  }
  for (const id of step.textileIds || []) {
    const tx = model.textiles?.get?.(id);
    if (!tx) continue;
    // 和料表同一个口径：短布面的名字里已经有尺寸，普通布面按尺寸分行
    const { def, id: tid, fest, key } = textileRow(model, tx);
    const base = def ? partName(def) : "";
    const size = tx.w && tx.h && !fest ? `${tx.w}×${tx.h} cm` : "";
    bump(map, key, {
      key, id: tid, kind: "textiles",
      name: [base, size].filter(Boolean).join(" ") || size,
      color: tx.color, colorName: colorName(tx.color),
    });
  }
  return [...map.values()];
}

export function stepItems(model, step) {
  const rows = [];
  for (const r of step.connectors || []) {
    rows.push({
      key: `connectors:${r.type}`, id: r.type, kind: "connectors",
      name: r.name, count: r.count,
    });
  }
  for (const r of step.tubes || []) {
    rows.push({
      key: `${r.tubeId}|${r.color}`, id: r.tubeId, kind: "tubes",
      name: r.name, color: r.color, colorName: r.colorName, count: r.count,
    });
  }
  for (const r of step.panels || []) {
    rows.push({
      key: `${r.panelId}|${r.color}`, id: r.panelId, kind: "panels",
      name: r.name, color: r.color, colorName: r.colorName, count: r.count,
    });
  }
  for (const r of step.reinforcements || []) {
    rows.push({
      key: `reinforcements:${r.id}`, id: r.id, kind: "reinforcements",
      name: r.name, count: r.count,
    });
  }
  rows.push(...extraStepItems(model, step));
  return numberItems(rows);
}

function attachPositions(items, posMap) {
  for (const it of items) it.positions = posMap.get(it.key) || [];
}

const iconCache = new Map();

async function iconImage(id, kind) {
  const inner = partIcon(id, kind);
  const key = inner;
  if (iconCache.has(key)) return iconCache.get(key);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="64" height="64" fill="none">${String(inner).replaceAll("currentColor", INK)}</svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  iconCache.set(key, img);
  return img;
}

async function loadIcons(items) {
  const map = new Map();
  await Promise.all(items.map(async (it) => {
    try {
      map.set(it.num, await iconImage(it.id, it.kind));
    } catch {
      map.set(it.num, null);
    }
  }));
  return map;
}

function pickWorlds(item, cam, target, oneEach) {
  const facing = (item.positions || []).filter((w) => facingXZ(w, cam, target));
  if (!facing.length) return [];
  if (!oneEach) return facing;
  let best = facing[0], bestD = dist2(facing[0], cam);
  for (let i = 1; i < facing.length; i++) {
    const d = dist2(facing[i], cam);
    if (d < bestD) { best = facing[i]; bestD = d; }
  }
  return [best];
}

function projectCallouts(scene, items, aspect, oneEach) {
  const cam = scene.camera.position;
  const target = scene.controls?.target || { x: 0, y: 0, z: 0 };
  const worlds = [];
  const nums = [];
  for (const it of items) {
    for (const w of pickWorlds(it, cam, target, oneEach)) {
      worlds.push(towardCam(w, cam, MARK_PULL));
      nums.push(it.num);
    }
  }
  if (!worlds.length) return [];
  const proj = scene.projectWorld(worlds, aspect);
  const marks = [];
  for (let i = 0; i < proj.length; i++) {
    if (!proj[i]) continue;
    marks.push({ num: nums[i], u: proj[i].u, v: proj[i].v, z: proj[i].z });
  }
  return marks;
}

async function captureView(scene, model, yaw, { bounds, width, height, items, oneEach }) {
  const aspect = width / height;
  scene._viewSize = { w: width, h: height };
  try {
    scene.frameFromYaw(model, yaw, { silent: true, bounds, aspect, margin: FIT });
    scene._updateTreeCamera?.();
    const marks = items && items.length ? projectCallouts(scene, items, aspect, !!oneEach) : [];
    const img = await loadImage(scene.snapshot({
      hideGrid: false,
      hideRoom: true,
      hideLabels: true,
      mime: "image/png",
      width,
      height,
      pixelRatio: 2.5,
    }));
    return { img, marks };
  } finally {
    scene._viewSize = null;
  }
}

function kindLabel(kind, copy) {
  if (kind === "risers") return copy.kindRisers;
  if (kind === "panels") return copy.kindPanels;
  return copy.kindFrame;
}

function newPageCanvas() {
  const c = document.createElement("canvas");
  c.width = CW;
  c.height = CH;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, CW, mm(0.9));
  return { c, ctx };
}

function paintLegend(ctx, items, icons, x, y, maxW, maxY) {
  const n = items.length;
  if (!n) return;
  const cols = n > 16 ? 5 : n > 8 ? 4 : Math.min(3, n);
  const colGap = mm(4);
  const colW = (maxW - colGap * (cols - 1)) / cols;
  const rowH = mm(5.4);
  const badgeR = mm(1.65);
  const numW = mm(6.4);
  const dotW = mm(3.6);
  const iconS = mm(3.4);
  const iconW = mm(4.4);
  const nameGap = mm(1.6);
  const visible = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const cellY = y + row * rowH;
    if (cellY + rowH > maxY) break;
    visible.push({ i, col: i % cols, cellY, it: items[i] });
  }

  ctx.font = font(700, mm(2.35));
  let qtyTextW = mm(3.2);
  for (const v of visible) {
    qtyTextW = Math.max(qtyTextW, ctx.measureText(`×${v.it.count}`).width);
  }
  const qtyColW = qtyTextW;
  const nameX0 = numW + dotW + iconW;
  const nameBudget = Math.max(mm(5), colW - nameX0 - nameGap - qtyColW);
  ctx.font = font(400, mm(2.55));
  const names = new Map();
  const nameColW = new Array(cols).fill(0);
  for (const v of visible) {
    const name = ellipsize(ctx, itemCaption(v.it), nameBudget);
    names.set(v.i, name);
    nameColW[v.col] = Math.max(nameColW[v.col], ctx.measureText(name).width);
  }

  ctx.textBaseline = "middle";
  for (const v of visible) {
    const { it, col, cellY } = v;
    const cellX = x + col * (colW + colGap);
    const mid = cellY + rowH / 2;

    drawBadge(ctx, cellX + numW / 2, mid, it.num, badgeR);
    ctx.textBaseline = "middle";

    const dotX = cellX + numW;
    if (it.color) {
      ctx.fillStyle = colorHex(it.color);
      ctx.beginPath();
      ctx.arc(dotX + mm(1.15), mid, mm(1.15), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(31,36,48,0.16)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    const iconX = dotX + dotW;
    const icon = icons.get(it.num);
    if (icon) ctx.drawImage(icon, iconX, mid - iconS / 2, iconS, iconS);

    const nameX = iconX + iconW;
    ctx.font = font(400, mm(2.55));
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.fillText(names.get(v.i), nameX, mid);

    const qty = `×${it.count}`;
    const qtyX = nameX + nameColW[col] + nameGap;
    ctx.font = font(700, mm(2.35));
    ctx.fillStyle = ACCENT;
    ctx.textAlign = "left";
    ctx.fillText(qty, qtyX, mid);
  }
  ctx.textBaseline = "top";
}

// 方案页的二维码印在每一页右下角：二维码在上，网址在下；封面上再加一句说明。
const STAMP_QR_COVER = 26;
const STAMP_QR_STEP = 17;
const STAMP_GAP = 4;

function stampWidth(ctx, stamp, qr, withHint) {
  ctx.font = font(600, mm(2.3));
  let w = Math.max(mm(qr), ctx.measureText(stamp.host).width);
  if (withHint) {
    ctx.font = font(400, mm(2.2));
    w = Math.max(w, ctx.measureText(stamp.hint).width);
  }
  return w;
}

/** 画在右下角，返回占掉的宽度（料表要给它让出来）。 */
function paintStamp(ctx, stamp, qr, withHint) {
  const w = stampWidth(ctx, stamp, qr, withHint);
  const cx = mm(PAGE_W - M) - w / 2;
  const bottom = mm(PAGE_H - 2.5);
  const size = mm(qr);
  const qrY = bottom - mm(2.3) - mm(0.8) - size;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = ACCENT;
  ctx.font = font(600, mm(2.3));
  ctx.fillText(stamp.host, cx, bottom);
  drawQr(ctx, stamp.url, cx - size / 2, qrY, size);
  if (withHint) {
    ctx.fillStyle = MUTED;
    ctx.font = font(400, mm(2.2));
    ctx.fillText(stamp.hint, cx, qrY - mm(0.8));
  }
  ctx.restore();
  return w + mm(STAMP_GAP);
}

function paintCover(ctx, { front, back, copy, items, icons, fill, frontMarks, backMarks, stamp }) {
  const box = coverBox();
  ctx.fillStyle = INK;
  ctx.font = font(600, mm(5.4));
  ctx.textBaseline = "top";
  const title = `${copy.coverTitle}  ·  ${copy.modelName}`;
  ctx.fillText(ellipsize(ctx, title, mm(PAGE_W - M * 2 - 36)), mm(M), mm(4));
  ctx.fillStyle = MUTED;
  ctx.font = font(500, mm(3));
  ctx.textAlign = "right";
  ctx.fillText(copy.product, mm(PAGE_W - M), mm(5.2));
  ctx.textAlign = "left";
  const meta = [copy.date, copy.stepsLine, copy.sizeLine].filter(Boolean).join("   ·   ");
  ctx.fillText(ellipsize(ctx, meta, mm(PAGE_W - M * 2)), mm(M), mm(10.5));
  paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks);

  const bomY = box.imgY + box.imgH + 1.5;
  const stampW = stamp ? paintStamp(ctx, stamp, STAMP_QR_COVER, true) : 0;
  ctx.fillStyle = ACCENT;
  ctx.font = font(600, mm(3.2));
  ctx.fillText(copy.bomTitle, mm(M), mm(bomY));
  paintLegend(ctx, items, icons, mm(M), mm(bomY + 4.2), mm(PAGE_W - M * 2) - stampW, mm(PAGE_H - 3));
}

function paintStep(ctx, { front, back, copy, heading, items, icons, k, n, fill, frontMarks, backMarks, stamp }) {
  const box = stepBox();
  ctx.fillStyle = INK;
  ctx.font = font(600, mm(4.4));
  ctx.textBaseline = "top";
  ctx.fillText(ellipsize(ctx, heading, mm(PAGE_W - M * 2 - 28)), mm(M), mm(3.5));
  ctx.fillStyle = MUTED;
  ctx.font = font(500, mm(3));
  ctx.textAlign = "right";
  ctx.fillText(`${k}/${n}`, mm(PAGE_W - M), mm(4.4));
  ctx.textAlign = "left";
  paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks);

  const partsY = box.imgY + box.imgH + 1.2;
  const stampW = stamp ? paintStamp(ctx, stamp, STAMP_QR_STEP, false) : 0;
  ctx.fillStyle = ACCENT;
  ctx.font = font(600, mm(3));
  ctx.fillText(copy.thisStep, mm(M), mm(partsY));
  if (!items.length) {
    ctx.fillStyle = MUTED;
    ctx.font = font(400, mm(2.8));
    ctx.fillText(copy.none, mm(M), mm(partsY + 4.4));
  } else {
    paintLegend(ctx, items, icons, mm(M), mm(partsY + 4), mm(PAGE_W - M * 2) - stampW, mm(PAGE_H - 2.5));
  }
}

async function pageToPdf(doc, canvas, first) {
  const jpeg = canvas.toDataURL("image/jpeg", 0.96);
  if (!first) doc.addPage();
  doc.addImage(jpeg, "JPEG", 0, 0, PAGE_W, PAGE_H);
}

function yieldUi() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function restoreBuilder(builder, saved) {
  builder.manualLabels = false;
  builder.highlight = saved.highlight;
  builder.assemblyStep = saved.step;
  builder.setMode(saved.mode);
  builder.selection.clear();
  if (saved.selection) {
    for (const [id, kind] of saved.selection) builder.selection.set(id, kind);
  }
  builder.selectedNodeId = saved.selectedNodeId;
  builder.refresh();
}

export function stepFilter(step) {
  return {
    nodes: new Set(step.nodeIds || []),
    tubes: new Set(step.tubeIds || []),
    panels: new Set(step.panelIds || []),
    textiles: new Set(step.textileIds || []),
    slides: new Set(step.slideIds || []),
    fittings: new Set(step.fittingIds || []),
  };
}

/**
 * @param {{
 *   scene: object,
 *   builder: object,
 *   model: object,
 *   name: string,
 *   bom: object | null,
 *   copy: Record<string, string>,
 *   filename: string,
 *   onProgress?: (p: { page: number, total: number }) => void,
 *   stamp?: { url: string, host: string, hint: string } | null,
 * }} opts
 *
 * stamp 是方案页的网址和二维码（src/sharePage.ts），给了就印在每一页右下角。
 */
export async function exportAssemblyPdf({ scene, builder, model, name, bom, copy, filename, onProgress, stamp }) {
  builder.enterAssembly();
  const steps = builder.buildPlan?.steps || [];
  if (!steps.length) {
    const err = new Error("empty");
    err.code = "empty";
    throw err;
  }

  const total = 1 + steps.length;
  const report = (page) => onProgress?.({ page, total });

  const saved = {
    mode: builder.mode,
    step: builder.assemblyStep,
    pose: scene.getCameraPose(),
    sceneOn: !!scene._sceneOn,
    selection: [...builder.selection],
    selectedNodeId: builder.selectedNodeId,
    highlight: builder.highlight,
    controls: scene.controls ? scene.controls.enabled : true,
  };

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const itemsCover = coverItems(bom);
  attachPositions(itemsCover, collectPositions(model, null));
  const coverCopy = {
    ...copy,
    modelName: name || copy.product || "design",
    stepsLine: String(copy.stepsLine || "").replaceAll("{n}", String(steps.length)),
  };
  const cover = coverBox();
  const step = stepBox();
  const coverSnap = snapSize(cover.imgW, cover.imgH);
  const stepSnap = snapSize(step.imgW, step.imgH);
  const fill = sceneFill(scene);

  try {
    if (scene.controls) scene.controls.enabled = false;
    if (scene.projection && scene.projection !== "perspective") scene.setProjection("perspective");
    builder.highlight = null;
    builder.selection.clear();
    builder.selectedNodeId = null;
    builder.manualLabels = false;
    if (builder.mode !== "select") builder.setMode("select");
    else builder.refresh();

    report(1);
    await yieldUi();
    const coverIcons = await loadIcons(itemsCover);
    const fullBounds = model.bounds(geometry().connectorSize / 2);
    // 封面只展示成品外形；编号圆圈留给总料表和各步截图。
    const coverFront = await captureView(scene, model, 0, {
      ...coverSnap, bounds: fullBounds,
    });
    const coverBack = await captureView(scene, model, Math.PI, {
      ...coverSnap, bounds: fullBounds,
    });
    {
      const { c, ctx } = newPageCanvas();
      paintCover(ctx, {
        front: coverFront.img, back: coverBack.img, copy: coverCopy,
        items: itemsCover, icons: coverIcons, fill,
        frontMarks: coverFront.marks, backMarks: coverBack.marks, stamp,
      });
      await pageToPdf(doc, c, true);
    }

    builder.assemblyStep = 0;
    builder.setMode("assembly");

    for (let i = 0; i < steps.length; i++) {
      report(i + 2);
      await yieldUi();
      builder.setAssemblyStep(i);
      const s = steps[i];
      const items = stepItems(model, s);
      attachPositions(items, collectPositions(model, stepFilter(s)));
      const icons = await loadIcons(items);
      const bounds = visibleBounds(model, builder);
      const front = await captureView(scene, model, 0, {
        ...stepSnap, bounds, items, oneEach: false,
      });
      const back = await captureView(scene, model, Math.PI, {
        ...stepSnap, bounds, items, oneEach: false,
      });
      const heading = copy.stepHeading
        .replace("{k}", String(i + 1))
        .replace("{n}", String(steps.length))
        .replace("{kind}", kindLabel(s.kind, copy))
        .replace("{title}", s.title || "");
      const { c, ctx } = newPageCanvas();
      paintStep(ctx, {
        front: front.img, back: back.img, copy, heading, items, icons,
        k: i + 1, n: steps.length, fill,
        frontMarks: front.marks, backMarks: back.marks, stamp,
      });
      await pageToPdf(doc, c, false);
    }

    doc.save(filename || `${name || "design"}.pdf`);
  } finally {
    scene._viewSize = null;
    scene._labelDpr = 0;
    restoreBuilder(builder, saved);
    scene.setScene(saved.sceneOn);
    scene.setCameraPose(saved.pose);
    if (scene.controls) scene.controls.enabled = saved.controls;
    scene._lastW = 0;
    scene._lastH = 0;
    scene.onResize?.();
    scene.requestRender();
  }
}
