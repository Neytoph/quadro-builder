// 冻结模型，使用独立场景导出成品、总料表、区域与动作/完成图。
// 整页先画在 2D Canvas 再压成 JPEG，避免给 jsPDF 嵌 CJK 字体。
// 料表用「圆圈编号 + 图标 + 名称」；图上只标对应数字，不再往 3D 模型上写字。

import { jsPDF } from "jspdf";
import { Vector3 } from 'three';
import { layoutAssemblyMarks } from '../ui/assemblyOverlay';
import {
  partForFitting, partName, slideKindName, geometry, colorHex, colorName,
  reinforcementPart, poolLinerFor, getPartById, loadCatalog,
} from "./catalog.js";
import { connectorsForNode, textileRow, computeBOM } from "./bom.js";
import { POOL_KINDS, BuildModel } from "./model.js";
import { SceneManager } from "./scene.js";
import { computeAssemblyPlan, assemblyState, assemblyDetailState } from "./assemblyPlan.js";
import { waitSceneReady } from "./thumbShot.js";
import { applyFrameHex, loadTune } from "./colorTune.js";
import { componentStepLabel, componentPartId, componentOutputColor, componentFittingKey, componentSizeLabel } from './accessoryInfo.js';
import { partImageSrc } from "../ui/partImages";
import { drawQr } from "../sharePage";
import { getLang } from './i18n.js';

const PAGE_W = 297;
const PAGE_H = 210;
const PX = 10;
const CW = PAGE_W * PX;
const CH = PAGE_H * PX;
const PAPER = "#ffffff";
const INK = "#1f2430";
const MUTED = "#5c6570";
const WELL = "#f1f2f3";
const ACCENT = "#ea580c";
const M = 7;
const SNAP_LONG = 1400;
const FIT = 1.05;
const MARK_PULL = 8;
export const MANUAL_TEXT_MM = 3.6;
export const MANUAL_AUX_MM = 3.2;

function mm(n) { return n * PX; }

function font(weight, px) {
  return `${weight} ${Math.max(px, mm(MANUAL_AUX_MM))}px "PingFang SC","Hiragino Sans GB","Noto Sans SC","Source Han Sans SC","Microsoft YaHei","Segoe UI",sans-serif`;
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
    img.onerror = () => reject(manualError('resources', `图片载入失败: ${url.startsWith('data:') ? '场景截图' : url}`));
    img.src = url;
  });
}

function stepBox(partsH = 47, headerH = 20) {
  const gap = 2.5;
  const imgY = headerH;
  const imgH = PAGE_H - imgY - partsH - 3;
  const imgW = (PAGE_W - M * 2 - gap) / 2;
  return { gap, headerH, partsH, imgY, imgH, imgW, x0: M, x1: M + imgW + gap };
}

function coverBox(bomH = 54) {
  const gap = 2.5;
  const headerH = 16;
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
  ctx.font = font(600, mm(MANUAL_AUX_MM));
  const tw = ctx.measureText(text).width;
  const pad = mm(1.4);
  const bh = mm(6);
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
  ctx.font = font(600, mm(s.length > 2 ? MANUAL_AUX_MM : MANUAL_TEXT_MM));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y + r * 0.04);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

export function layoutManualCallouts(marks, width, height, radius = mm(2.8)) {
  if (marks.length > 6) throw manualError('details', '局部图实际材料圆圈超过六个');
  const placed = [];
  for (const side of [0, 1]) {
    const rows = marks.filter(mark => (mark.x < width / 2 ? 0 : 1) === side).sort((a, b) => a.y - b.y);
    rows.forEach((mark, index) => placed.push({ ...mark, anchorX: mark.x, anchorY: mark.y,
      x: side ? width - radius - 3 : radius + 3,
      y: radius + 3 + (height - radius * 2 - mm(10)) * (index + 1) / (rows.length + 1) }));
  }
  return placed;
}

function drawMarks(ctx, img, x, y, w, h, marks, local = false) {
  if (!img || !img.width || !marks || !marks.length) return;
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  const ox = x + (w - dw) / 2;
  const oy = y + (h - dh) / 2;
  const r = mm(2.8);
  const placed = marks.map((m) => ({
    num: m.num,
    x: ox + m.u * dw,
    y: oy + m.v * dh,
    z: m.z,
  })).filter((m) => m.x > x - r && m.x < x + w + r && m.y > y - r && m.y < y + h + r);
  placed.sort((a, b) => a.z - b.z);
  const source = placed.map(m => ({ x: m.x - x, y: m.y - y, label: String(m.num) }));
  const labels = local ? layoutManualCallouts(source, w, h, r) : layoutAssemblyMarks(source, w, h, { radius: r, gap: r * 0.15 });
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2));
  ctx.clip();
  for (const m of labels) {
    if (Math.hypot(m.x - m.anchorX, m.y - m.anchorY) > 1) {
      ctx.beginPath(); ctx.moveTo(x + m.anchorX, y + m.anchorY); ctx.lineTo(x + m.x, y + m.y);
      ctx.strokeStyle = 'rgba(92,101,112,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    drawBadge(ctx, x + m.x, y + m.y, m.label, r);
  }
  ctx.restore();
}

function paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks, local = false) {
  const { x0, x1, imgY, imgW, imgH } = box;
  drawShot(ctx, front, mm(x0), mm(imgY), mm(imgW), mm(imgH), fill);
  drawShot(ctx, back, mm(x1), mm(imgY), mm(imgW), mm(imgH), fill);
  paintCaption(ctx, copy.front, mm(x0), mm(imgY), mm(imgH));
  paintCaption(ctx, copy.back, mm(x1), mm(imgY), mm(imgH));
  drawMarks(ctx, front, mm(x0), mm(imgY), mm(imgW), mm(imgH), frontMarks, local);
  drawMarks(ctx, back, mm(x1), mm(imgY), mm(imgW), mm(imgH), backMarks, local);
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
    pushPos(map, `${p.panelId}|${componentOutputColor(p)}`, centroid(cor));
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
    const def = getPartById(componentPartId(f)) || partForFitting(f.kind, f.mask);
    const fid = def ? def.id : f.kind;
    pushPos(map, `fittings:${componentFittingKey(f, fid)}`, world);
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
  const take = (group, list) => {
    for (const r of list || []) {
      const id = r.id || r.type || r.tubeId || r.panelId || r.kind;
      const rawKey = r.key ?? (group === 'connectors' ? r.type : `${id}|${r.color || ''}`);
      const key = group === 'connectors' ? `connectors:${id}`
        : group === 'slides' ? `slides:${id}`
        : ['fittings', 'reinforcements', 'screws'].includes(group) ? (String(rawKey).startsWith(`${group}:`) ? rawKey : `${group}:${rawKey}`)
        : rawKey;
      rows.push({
        key,
        ledgerKey: rawKey,
        id,
        kind: group,
        name: niceName(r),
        color: r.color || null,
        colorName: r.colorName || null,
        count: r.count,
        instanceIds: r.instanceIds || [],
      });
    }
  };
  // The manual excludes screw statistics; the platform BOM remains compatible.
  for (const group of ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'wheels', 'fittings', 'reinforcements']) take(group, bom[group]);
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
    const def = getPartById(componentPartId(f)) || partForFitting(f.kind, f.mask);
    const fid = def ? def.id : f.kind;
    const key = `fittings:${componentFittingKey(f, fid)}`, size = componentSizeLabel(f);
    bump(map, key, {
      key, id: fid, kind: "fittings",
      name: (def ? partName(def) : f.kind) + (size ? ` ${size}` : ''),
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
  if (step.parts) return coverItems(step.parts);
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

const iconCache = new Map();

async function iconImage(id, kind) {
  const key = partImageSrc(id);
  if (!key) throw manualError('resources', `零件图片缺失: ${id}`, [{ code: 'MISSING_PART_IMAGE', severity: 'error', partId: id, kind }]);
  if (iconCache.has(key)) return iconCache.get(key);
  const img = await loadImage(key);
  iconCache.set(key, img);
  return img;
}

async function loadIcons(items) {
  const map = new Map();
  await Promise.all(items.map(async (it) => {
    map.set(it.num, await iconImage(it.id, it.kind));
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

async function captureView(scene, model, yaw, { bounds, width, height, items, oneEach, direction }) {
  const aspect = width / height;
  scene._viewSize = { w: width, h: height };
  try {
    if (direction) scene._frameAlong(model, new Vector3(...direction).normalize(), { silent: true, bounds, aspect, margin: 1.18 });
    else scene.frameFromYaw(model, yaw, { silent: true, bounds, aspect, margin: FIT });
    scene._updateTreeCamera?.();
    const marks = items && items.length ? projectCallouts(scene, items, aspect, !!oneEach) : [];
    const img = await loadImage(scene.snapshot({
      hideGrid: false,
      hideRoom: true,
      hideLabels: true,
      mime: "image/png",
      width,
      height,
      pixelRatio: 1.5,
    }));
    return { img, marks };
  } finally {
    scene._viewSize = null;
  }
}

function kindLabel(kind, copy) {
  if (kind === 'accessories') return componentStepLabel();
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

export function measureManualLegend(ctx, items, maxW) {
  const n = items.length;
  if (!n) return { cols: 0, height: 0, rows: [], wrapped: [] };
  const cols = Math.min(3, n);
  const colGap = mm(4);
  const colW = (maxW - colGap * (cols - 1)) / cols;
  const minRowH = mm(15);
  const numW = mm(8);
  const dotW = mm(3.6);
  const iconW = mm(14);
  const nameGap = mm(1.6);
  ctx.font = font(700, mm(MANUAL_TEXT_MM));
  let qtyTextW = mm(3.2);
  for (const it of items) if (!it.referenceOnly) qtyTextW = Math.max(qtyTextW, ctx.measureText(`×${it.count}`).width);
  const qtyColW = qtyTextW;
  const nameX0 = numW + dotW + iconW;
  const nameBudget = Math.max(mm(5), colW - nameX0 - nameGap - qtyColW);
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  const wrapped = items.map(it => {
    const lines = [];
    let line = '';
    for (const char of itemCaption(it)) {
      if (line && ctx.measureText(line + char).width > nameBudget) { lines.push(line); line = ''; }
      line += char;
    }
    if (line) lines.push(line);
    return lines;
  });
  const rows = [];
  for (let offset = 0; offset < n; offset += cols) {
    const rowH = Math.max(minRowH, ...wrapped.slice(offset, offset + cols).map(lines => lines.length * mm(4.4) + mm(4)));
    rows.push({ offset, rowH });
  }
  return { cols, colW, colGap, numW, dotW, iconW, qtyColW, wrapped, rows, height: rows.reduce((sum, row) => sum + row.rowH, 0) };
}

function paintLegend(ctx, items, icons, x, y, maxW, maxY) {
  if (!items.length) return 0;
  const { cols, colW, colGap, numW, dotW, iconW, qtyColW, wrapped, rows } = measureManualLegend(ctx, items, maxW);
  const badgeR = mm(2.8), iconS = mm(12);
  const visible = [];
  let cellY = y;
  for (const { offset, rowH } of rows) {
    if (cellY + rowH > maxY) break;
    for (let col = 0; col < cols && offset + col < items.length; col++) visible.push({ i: offset + col, col, cellY, rowH, it: items[offset + col] });
    cellY += rowH;
  }

  ctx.textBaseline = "middle";
  for (const v of visible) {
    const { it, col, cellY, rowH } = v;
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
    else {
      ctx.fillStyle = MUTED;
      ctx.font = font(600, mm(5));
      ctx.fillText('?', iconX + iconS / 3, mid);
    }

    const nameX = iconX + iconW;
    ctx.font = font(400, mm(MANUAL_TEXT_MM));
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = 'top';
    const lines = wrapped[v.i];
    const top = mid - lines.length * mm(4.4) / 2;
    lines.forEach((line, index) => ctx.fillText(line, nameX, top + index * mm(4.4)));

    const qty = it.referenceOnly ? '' : `×${it.count}`;
    const qtyX = cellX + colW - qtyColW;
    ctx.font = font(700, mm(MANUAL_TEXT_MM));
    ctx.fillStyle = ACCENT;
    ctx.textAlign = "left";
    ctx.textBaseline = 'middle';
    ctx.fillText(qty, qtyX, mid);
  }
  ctx.textBaseline = "top";
  return visible.length;
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

function paintCover(ctx, { front, back, copy, items, icons, fill, frontMarks, backMarks, stamp, partsH }) {
  const box = coverBox(partsH);
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
  return paintLegend(ctx, items, icons, mm(M), mm(bomY + 4.2), mm(PAGE_W - M * 2) - stampW, mm(PAGE_H - 3)) || 0;
}

function paintStep(ctx, { front, back, copy, heading, items, icons, k, n, fill, frontMarks, backMarks, stamp, instructions = [], partsH, headerH = 20, instructionLines = null }) {
  const box = stepBox(partsH, headerH);
  ctx.fillStyle = INK;
  ctx.font = font(600, mm(4.4));
  ctx.textBaseline = "top";
  const headingLines = wrapManualText(ctx, heading, mm(PAGE_W - M * 2 - 28));
  headingLines.forEach((line, i) => ctx.fillText(line, mm(M), mm(3.5 + i * 5.4)));
  ctx.fillStyle = MUTED;
  ctx.font = font(500, mm(3));
  ctx.textAlign = "right";
  ctx.fillText(`${k}/${n}`, mm(PAGE_W - M), mm(4.4));
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  const lines = instructionLines || instructions.flatMap(line => wrapManualText(ctx, line, mm(PAGE_W - M * 2)));
  const textY = 5 + headingLines.length * 5.4;
  lines.forEach((line, i) => ctx.fillText(line, mm(M), mm(textY + i * 4.6)));
  if (copy.contextHint) {
    ctx.font = font(400, mm(2.2));
    const contextLines = wrapManualText(ctx, copy.contextHint, mm(PAGE_W - M * 2));
    contextLines.forEach((line, i) => ctx.fillText(line, mm(M), mm(headerH - contextLines.length * 4.2 - 1 + i * 4.2)));
  }
  paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks);

  const partsY = box.imgY + box.imgH + 1.2;
  const stampW = stamp ? paintStamp(ctx, stamp, STAMP_QR_STEP, false) : 0;
  ctx.fillStyle = ACCENT;
  ctx.font = font(600, mm(MANUAL_TEXT_MM));
  ctx.fillText(copy.thisStep, mm(M), mm(partsY));
  const legendY = mm(partsY + 4);
  if (!items.length) {
    ctx.fillStyle = MUTED;
    ctx.font = font(400, mm(MANUAL_TEXT_MM));
    ctx.fillText(copy.none, mm(M), mm(partsY + 4.4));
  } else {
    return paintLegend(ctx, items, icons, mm(M), legendY, mm(PAGE_W - M * 2) - stampW, mm(PAGE_H - 2.5)) || 0;
  }
  return 0;
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

export function stepFilter(step) {
  return {
    nodes: new Set(step.nodeIds || []),
    tubes: new Set(step.tubeIds || []),
    panels: new Set(step.panelIds || []),
    textiles: new Set(step.textileIds || []),
    slides: new Set(step.slideIds || []),
    fittings: new Set(step.fittingIds || []),
    clamps: new Set(step.clampIds || []),
  };
}

export function numberStepItems(items, numberedCover) {
  const numbers = new Map(numberedCover.map(item => [item.key, item.num]));
  return items.map(item => {
    const num = numbers.get(item.key);
    if (!num) throw new Error(`材料未列入总料表: ${item.key}`);
    return { ...item, num };
  });
}

function partCenter(model, id) {
  for (const key of ['nodes', 'clamps', 'slides', 'fittings']) {
    const part = model[key]?.get(id);
    if (part) return [part.x, part.y, part.z];
  }
  const tube = model.tubes.get(id);
  if (tube) return tubeMid(model, tube);
  const panel = model.panels.get(id) || model.textiles?.get(id);
  return panel ? centroid(model.panelCorners(panel)) : null;
}

function positionedItems(model, items, state = null) {
  const fallback = collectPositions(model);
  return items.map(item => ({
    ...item,
    positions: item.instanceIds?.length ? item.instanceIds.filter(id => !state?.visible || state.visible.has(id)).map(id => {
      const position = partCenter(model, id);
      const delta = state?.transforms?.get(id) || [0, 0, 0];
      return position && position.map((value, axis) => value + delta[axis]);
    }).filter(Boolean) : fallback.get(item.key) || [],
  }));
}

export const manualPositionedItems = positionedItems;

/** @param {any[] | null} [numberedCover] */
export function assemblyDetailItems(model, plan, step, group, numberedCover = null) {
  const cover = numberedCover || coverItems(plan.bom || computeBOM(model));
  const ids = new Set(group.partIds || []);
  const materialKeys = group.materialKeys?.length ? new Set(group.materialKeys) : null;
  const instances = plan.ledger?.instances || [];
  const rows = cover.map(item => {
    const instanceIds = [...new Set((item.instanceIds?.length ? item.instanceIds : instances
      .filter(row => row.group === item.kind && row.key === item.ledgerKey).flatMap(row => row.partIds))
      .filter(id => ids.has(id)))];
    return { ...item, instanceIds, referenceOnly: true };
  }).filter(item => item.instanceIds.length && (!materialKeys || materialKeys.has(`${item.kind}:${item.ledgerKey}`) || materialKeys.has(item.key)));
  if (rows.length > 6) throw manualError('details', `局部详图材料编号超过六项: ${group.id}`);
  return rows;
}

/** @param {any | null} [step] */
export function assemblyDetailDirection(group, step = null) {
  const value = group?.viewDirection;
  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) && value.some(v => v !== 0)) return [...value];
  if (value === 'back') return [-1, 0.65, -1];
  if (value === 'bottom') return [1, -0.65, 1];
  const front = [1, 0.65, 1];
  const selected = new Set(group?.operationIds || []);
  const motions = (step?.operations || []).filter(operation => selected.has(operation.id) && operation.direction?.length === 3)
    .map(operation => operation.direction).filter(direction => direction.some(value => value !== 0));
  const alignment = view => Math.max(0, ...motions.map(motion => Math.abs(view.reduce((sum, value, axis) => sum + value * motion[axis], 0)) / (Math.hypot(...view) * Math.hypot(...motion))));
  if (alignment(front) < 0.8) return front;
  return [front, [-1, 0.65, 1], [1, 0.65, -1], [1, -0.65, 1]].reduce((best, candidate) => alignment(candidate) < alignment(best) ? candidate : best, front);
}

export function assemblyDetailBounds(scene, model, plan, step, state) {
  const ids = new Set(state?.focusPartIds || []);
  if (!ids.size) return assemblyFocusBounds(scene, model, plan, step, state);
  const pieces = [...scene._indexParts(scene.buildGroup.children).values()]
    .filter(row => ids.has(row.id)).flatMap(row => row.pieces);
  const box = pieces.length ? scene._piecesBox(pieces) : null;
  const points = [...(box ? [box.min.toArray(), box.max.toArray()] : [...ids].map(id => partCenter(model, id)).filter(Boolean)),
    ...(state?.arrows || []).flatMap(arrow => [arrow.from, arrow.to])];
  if (!points.length) return assemblyFocusBounds(scene, model, plan, step, state);
  return boundsFor([0, 1, 2].map(axis => Math.min(...points.map(p => p[axis])) - 8),
    [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis])) + 8));
}

export function wrapManualText(ctx, text, maxW) {
  const lines = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > maxW) { lines.push(line.trimEnd()); line = ''; }
      line += char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function unionBounds(left, right) {
  return boundsFor(left.min.map((value, axis) => Math.min(value, right.min[axis])), left.max.map((value, axis) => Math.max(value, right.max[axis])));
}

export function renderedBounds(scene, model) {
  const pieces = [...scene._indexParts(scene.buildGroup.children).values()].flatMap(row => row.pieces);
  if (!pieces.length) return model.bounds(geometry().connectorSize / 2);
  const box = scene._piecesBox(pieces);
  return boundsFor(box.min.toArray(), box.max.toArray());
}

export function assemblyFocusBounds(scene, model, plan, step, state) {
  const region = plan.regions.find(region => region.id === step?.regionId);
  if (!region) return renderedBounds(scene, model);
  const ids = state?.visible || new Set(region.partIds);
  const pieces = [...scene._indexParts(scene.buildGroup.children).values()]
    .filter(row => ids.has(row.id)).flatMap(row => row.pieces);
  if (!pieces.length) return renderedBounds(scene, model);
  const box = scene._piecesBox(pieces);
  const bounds = boundsFor(box.min.toArray(), box.max.toArray());
  const positions = [
    ...(state?.interfaceMarks || []).map(mark => mark.position),
    ...(state?.arrows || []).flatMap(arrow => [arrow.from, arrow.to]),
  ];
  for (const position of positions) for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], position[axis] - 8);
    bounds.max[axis] = Math.max(bounds.max[axis], position[axis] + 8);
  }
  bounds.size = bounds.max.map((value, axis) => value - bounds.min[axis]);
  return bounds;
}

// Operation drawings use only the operated module and its actual support interfaces.
// This is a presentation filter: the frozen model, inventory and installed state stay intact.
export function assemblyPresentationState(model, plan, step, state, { detail = false } = {}) {
  if (!state || !step) return state;
  // 整层操作保留全部已装主体，才能把上方的新框架对应回原位置。
  if (step.action?.layer && !detail) return { ...state, interfaceMarks: [], contextFiltered: false };
  if (!detail && ['frame', 'risers', 'panels'].includes(step.kind)) return { ...state, contextFiltered: false };
  const region = plan.regions.find(region => region.id === step.regionId);
  const modulePreassembly = step.action?.scope === 'parts' && step.action.type === 'preassemble';
  const moduleInstallation = step.action?.scope === 'parts' && step.action.type === 'attach';
  if (modulePreassembly && state.actionStage === 'before') {
    const prepared = assemblyState(plan, plan.steps.indexOf(step));
    const visible = new Set(step.action.partIds);
    const transforms = new Map([...prepared.transforms].filter(([id]) => visible.has(id)));
    // 预拼零件图仅分开展示横管，不表达管件的真实插接路径。
    for (const id of step.tubeIds) transforms.set(id, (transforms.get(id) || [0, 0, 0]).map((v, axis) => v + (axis === 1 ? 8 : 0)));
    state = { ...state, visible, current: new Set(visible), done: new Set(), transforms, hiddenNewParts: new Set(), arrows: [], actionStage: 'parts' };
  }
  const allowed = new Set(modulePreassembly || moduleInstallation ? step.action.partIds : region?.partIds || step.partIds || []);
  const includeTube = id => {
    const tube = model.tubes.get(id);
    if (tube) { allowed.add(id); allowed.add(tube.a); allowed.add(tube.b); }
  };
  for (const id of [...allowed]) {
    includeTube(id);
    const panel = model.panels.get(id) || model.textiles?.get(id);
    if (panel) { includeTube(panel.a); includeTube(panel.b); }
    const clamp = model.clamps?.get(id);
    if (clamp) includeTube(model._clampBaseTube?.(clamp)?.id);
  }
  if (region?.accessoryType === 'roof-cover') {
    const support = plan.regions.find(r => r.id === region.supportRegionId);
    for (const id of support?.tubeIds || []) includeTube(id);
  }
  for (const marker of state.interfaceMarks || []) {
    if (marker.nodeId) {
      allowed.add(marker.nodeId);
      for (const tube of model.tubes.values()) if (tube.a === marker.nodeId || tube.b === marker.nodeId) includeTube(tube.id);
    }
    if (marker.supportTubeId) includeTube(marker.supportTubeId);
    // Slides attach between saved support rails rather than connector nodes.
    if (!marker.nodeId && !marker.supportTubeId && marker.position) {
      const distanceToSegment = tube => {
        const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
        if (!a || !b) return Infinity;
        const start = [a.x, a.y, a.z], end = [b.x, b.y, b.z];
        const d = end.map((value, axis) => value - start[axis]);
        const t = Math.max(0, Math.min(1, d.reduce((sum, value, axis) => sum + value * (marker.position[axis] - start[axis]), 0) / (d.reduce((sum, value) => sum + value * value, 0) || 1)));
        return Math.hypot(...d.map((value, axis) => start[axis] + value * t - marker.position[axis]));
      };
      [...model.tubes.values()].filter(tube => state.visible.has(tube.id)).map(tube => ({ tube, distance: distanceToSegment(tube) })).sort((a, b) => a.distance - b.distance).slice(0, 4).filter(row => row.distance < 35).forEach(row => includeTube(row.tube.id));
    }
  }
  if (moduleInstallation) {
    // 局部框架保留承托立柱直到基础的连接关系，不把整个大区域缩进操作图。
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const tube of model.tubes.values()) {
        if (!state.visible.has(tube.id) || allowed.has(tube.id) || tube.arm || tube.link || tube.bow) continue;
        const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
        if (!a || !b || Math.max(a.y, b.y) > step.y + 0.6) continue;
        if (Math.abs(a.x - b.x) > 0.6 || Math.abs(a.z - b.z) > 0.6) continue;
        if (allowed.has(tube.a) || allowed.has(tube.b)) { includeTube(tube.id); expanded = true; }
      }
    }
    for (const tube of model.tubes.values()) {
      if (state.visible.has(tube.id) && allowed.has(tube.a) && allowed.has(tube.b)) includeTube(tube.id);
    }
  }
  if (detail) {
    for (const id of [...allowed]) if (model.panels.has(id) || model.textiles?.has(id)) allowed.delete(id);
  }
  const filter = ids => new Set([...ids].filter(id => allowed.has(id)));
  return { ...state, current: filter(state.current), done: filter(state.done), visible: filter(state.visible), contextFiltered: [...state.visible].some(id => !allowed.has(id)) };
}

function boundsFor(min, max) {
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
}

function projectStateMarks(scene, state, aspect) {
  const marks = [];
  for (const marker of state?.interfaceMarks || []) {
    const arrow = state.arrows?.find(arrow => arrow.id === marker.id);
    const delta = state.transforms?.get(marker.nodeId);
    const detached = delta && marker.position.map((value, axis) => value + delta[axis]);
    const positions = marker.positions || (arrow ? [arrow.from, arrow.to] : detached ? [marker.position, detached] : [marker.position]);
    for (const position of positions.filter(Boolean)) {
      const point = scene.projectWorld([position], aspect)[0];
      if (point) marks.push({ ...point, num: `I${String(marker.id).split('-').at(-1)}` });
    }
  }
  return marks;
}

function drawArrows(ctx, img, x, y, w, h, arrows) {
  if (!arrows?.length) return;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const ox = x + (w - dw) / 2, oy = y + (h - dh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2)); ctx.clip();
  ctx.strokeStyle = ACCENT; ctx.fillStyle = ACCENT; ctx.lineWidth = mm(0.7);
  for (const arrow of arrows) {
    const from = [ox + arrow.from.u * dw, oy + arrow.from.v * dh];
    const to = [ox + arrow.to.u * dw, oy + arrow.to.v * dh];
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...to);
    ctx.lineTo(to[0] - mm(3) * Math.cos(angle - 0.45), to[1] - mm(3) * Math.sin(angle - 0.45));
    ctx.lineTo(to[0] - mm(3) * Math.cos(angle + 0.45), to[1] - mm(3) * Math.sin(angle + 0.45));
    ctx.closePath(); ctx.fill();
    if (arrow.order) {
      const label = arrow.order <= 20 ? String.fromCodePoint(0x2460 + arrow.order - 1) : `(${arrow.order})`;
      const lx = Math.max(x + mm(4), Math.min(x + w - mm(4), from[0])), ly = Math.max(y + mm(4), Math.min(y + h - mm(9), from[1] - mm(4)));
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(lx - mm(2.5), ly - mm(2.5), mm(5), mm(5));
      ctx.font = font(600, mm(MANUAL_TEXT_MM)); ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx, ly);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = ACCENT;
    }
  }
  ctx.restore();
}

export function manualPartsHeight(ctx, items, maxW, cover = false) {
  const height = measureManualLegend(ctx, items, maxW).height / PX;
  // 六行短表完整留在图示页，图示至少保留 85 mm 高度。
  // 更长的表保留较大图示，并让续页包含多行物料。
  const maxHeight = height <= 100 ? (cover ? 106 : 102) : (cover ? 91 : 82);
  return Math.min(maxHeight, Math.max(cover ? 54 : 47, Math.ceil(height + 6)));
}

function legendChunks(items, cover, icons, stamp) {
  const chunks = [];
  let consumed = 0;
  const measurement = newPageCanvas();
  const stampW = stamp ? stampWidth(measurement.ctx, stamp, cover ? STAMP_QR_COVER : STAMP_QR_STEP, cover) + mm(STAMP_GAP) : 0;
  const maxW = mm(PAGE_W - M * 2) - stampW;
  const partsH = manualPartsHeight(measurement.ctx, items, maxW, cover);
  measurement.c.width = measurement.c.height = 0;
  while (consumed < items.length) {
    const { c, ctx } = newPageCanvas();
    const box = cover ? coverBox(partsH) : stepBox(partsH);
    const y = chunks.length ? mm(17) : mm(box.imgY + box.imgH + (cover ? 5.7 : 5.2));
    const count = paintLegend(ctx, items.slice(consumed), icons, mm(M), y, maxW, mm(PAGE_H - (chunks.length ? M : 3)));
    c.width = c.height = 0;
    if (!count) throw new Error('材料图例没有可用分页空间');
    chunks.push(items.slice(consumed, consumed + count)); consumed += count;
  }
  return { chunks: chunks.length ? chunks : [[]], partsH };
}

function instructionChunks(instructions) {
  const { c, ctx } = newPageCanvas();
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  const lines = [];
  for (const instruction of instructions) {
    let line = '';
    for (const char of String(instruction)) {
      if (line && ctx.measureText(line + char).width > mm(PAGE_W - M * 2 - 35)) { lines.push(line); line = ''; }
      line += char;
    }
    if (line) lines.push(line);
    lines.push('');
  }
  c.width = c.height = 0;
  const chunks = [];
  for (let offset = 0; offset < lines.length; offset += 35) chunks.push(lines.slice(offset, offset + 35));
  return chunks;
}

function paintTextPage(ctx, title, lines, stamp) {
  ctx.fillStyle = INK; ctx.font = font(600, mm(4.4)); ctx.textBaseline = 'top';
  ctx.fillText(ellipsize(ctx, title, mm(PAGE_W - M * 2)), mm(M), mm(5));
  if (stamp) paintStamp(ctx, stamp, STAMP_QR_STEP, false);
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  lines.forEach((line, i) => ctx.fillText(line, mm(M), mm(18 + i * 5)));
}

function manualSafetyCopy() {
  const lang = getLang();
  if (lang === 'de') return { safetyTitle: 'Vor dem Aufbau', safetyNotice: 'Teile zuerst anhand der Gesamtstückliste zählen und nach Länge und Farbe sortieren. Nach dem vollständigen Zusammenstecken von unten nach oben verschrauben. An Plattenpositionen Plattenschrauben verwenden. Vor der Benutzung die offizielle Sicherheitsanweisung beachten.', safetySource: 'Offizielle Sicherheitsanweisung', detailTitle: 'Lokale Montageschritte', detailReference: 'Materialnummern: Mengen sind im Hauptschritt enthalten.', locationView: 'Position im Modell', viewFront: 'Vorderseite', viewBack: 'Rückseite', viewBottom: 'Unterseite', viewCustom: 'Angegebene Blickrichtung', continuation: 'Fortsetzung' };
  if (lang === 'en') return { safetyTitle: 'Before assembly', safetyNotice: 'First count the parts against the full parts list and sort them by length and colour. After the complete structure is connected, fasten from bottom to top. Use panel screws at panel positions. Follow the official safety instructions before use.', safetySource: 'Official safety instructions', detailTitle: 'Local assembly actions', detailReference: 'Material references: quantities are included in the main step.', locationView: 'Location in model', viewFront: 'Front', viewBack: 'Back', viewBottom: 'Underside', viewCustom: 'Specified view direction', continuation: 'Continued' };
  return { safetyTitle: '搭建前须知', safetyNotice: '先按总表清点零件，按长度与颜色分组。完整拼好后，从下往上固定；板位使用板螺丝。使用前请核对官方安全指南。', safetySource: '官方安全指南', detailTitle: '局部动作详图', detailReference: '材料编号参考；数量已计入本步。', locationView: '成品定位', viewFront: '正面', viewBack: '背面', viewBottom: '底部', viewCustom: '指定视角', continuation: '续页' };
}

export function manualStepTextLayout(ctx, heading, instructions, contextHint = '') {
  ctx.font = font(600, mm(4.4));
  const headingLines = wrapManualText(ctx, heading, mm(PAGE_W - M * 2 - 28));
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  const allLines = instructions.flatMap(line => wrapManualText(ctx, line, mm(PAGE_W - M * 2)));
  ctx.font = font(400, mm(MANUAL_AUX_MM));
  const contextH = contextHint ? wrapManualText(ctx, contextHint, mm(PAGE_W - M * 2)).length * 4.2 + 1 : 0;
  const capacity = Math.max(1, Math.floor((52 - 7 - headingLines.length * 5.4 - contextH) / 4.6));
  const instructionLines = allLines.slice(0, capacity);
  return { instructionLines, remainingLines: allLines.slice(capacity), headerH: Math.max(20, Math.ceil(7 + headingLines.length * 5.4 + instructionLines.length * 4.6 + contextH)) };
}

export function manualDetailPageGroups(ctx, groups, copy) {
  const pages = [];
  let page = [];
  for (const group of groups) {
    ctx.font = font(600, mm(MANUAL_TEXT_MM));
    const titleLines = wrapManualText(ctx, group.title || copy.detailTitle, mm(138.5));
    ctx.font = font(400, mm(MANUAL_TEXT_MM));
    const lines = (group.instructions || []).flatMap(line => wrapManualText(ctx, line, mm(138.5)));
    const legendH = Math.max(30, measureDetailReferences(ctx, group.items, mm(104.5)).height / PX);
    const compact = titleLines.length * 4.6 + lines.length * 4.6 + 7 + legendH + 96 <= 173;
    if (!compact) {
      if (page.length) { pages.push(page); page = []; }
      ctx.font = font(600, mm(MANUAL_TEXT_MM));
      const wideTitleLines = wrapManualText(ctx, group.title || copy.detailTitle, mm(245));
      ctx.font = font(400, mm(MANUAL_TEXT_MM));
      const wideLines = (group.instructions || []).flatMap(line => wrapManualText(ctx, line, mm(245)));
      const height = 9 + wideTitleLines.length * 4.6 + wideLines.length * 4.6 + 46 + measureManualLegend(ctx, group.items, mm(245)).height / PX;
      if (height > 180) throw manualError('details', `局部动作说明超过单页容量: ${group.id}`);
      pages.push([{ ...group, titleLines: wideTitleLines, lines: wideLines, height, wide: true }]);
    } else {
      page.push({ ...group, titleLines, lines, legendH, compact: true });
      if (page.length === 2) { pages.push(page); page = []; }
    }
  }
  if (page.length) pages.push(page);
  for (const page of pages) if (page.length === 1 && page[0].compact) {
    const group = page[0];
    ctx.font = font(600, mm(MANUAL_TEXT_MM)); group.titleLines = wrapManualText(ctx, group.title || copy.detailTitle, mm(245));
    ctx.font = font(400, mm(MANUAL_TEXT_MM)); group.lines = (group.instructions || []).flatMap(line => wrapManualText(ctx, line, mm(245)));
    group.height = 9 + group.titleLines.length * 4.6 + group.lines.length * 4.6 + 46 + measureManualLegend(ctx, group.items, mm(245)).height / PX;
    group.compact = false; group.wide = true;
  }
  return pages;
}

function measureDetailReferences(ctx, items, maxW) {
  const cols = Math.min(2, items.length || 1), gap = mm(2);
  const colW = (maxW - gap * (cols - 1)) / cols;
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  const wrapped = items.map(item => wrapManualText(ctx, itemCaption(item), colW - mm(18)));
  const rows = [];
  for (let offset = 0; offset < items.length; offset += cols) rows.push({ offset, height: Math.max(mm(12), ...wrapped.slice(offset, offset + cols).map(lines => lines.length * mm(4.4) + mm(2))) });
  return { cols, colW, gap, wrapped, rows, height: rows.reduce((sum, row) => sum + row.height, 0) };
}

function paintDetailReferences(ctx, items, icons, x, y, maxW) {
  const layout = measureDetailReferences(ctx, items, maxW);
  let rowY = y;
  for (const row of layout.rows) {
    for (let col = 0; col < layout.cols && row.offset + col < items.length; col++) {
      const index = row.offset + col, item = items[index], cellX = x + col * (layout.colW + layout.gap), mid = rowY + row.height / 2;
      drawBadge(ctx, cellX + mm(3), mid, item.num, mm(2.8));
      ctx.drawImage(icons.get(item.num), cellX + mm(7), mid - mm(4), mm(8), mm(8));
      ctx.font = font(400, mm(MANUAL_TEXT_MM)); ctx.fillStyle = INK; ctx.textBaseline = 'top';
      const lines = layout.wrapped[index], top = mid - lines.length * mm(4.4) / 2;
      lines.forEach((line, lineIndex) => ctx.fillText(line, cellX + mm(17), top + lineIndex * mm(4.4)));
    }
    rowY += row.height;
  }
}

export function manualStepDetailDescriptors(ctx, model, plan, index, itemsCover, copy) {
  const step = plan.steps[index];
  const heading = (copy.stepHeading || '{k}/{n} · {title}').replace('{k}', String(index + 1)).replace('{n}', String(plan.steps.length)).replace('{kind}', kindLabel(step.kind, copy)).replace('{title}', step.title || '');
  const groups = (step.detailGroups || []).map(group => {
    const operations = (step.operations || []).filter(operation => group.operationIds.includes(operation.id));
    const instructions = operations.length ? operations.flatMap(operation => (operation.instructions || []).map(line => `${operation.order >= 1 && operation.order <= 20 ? String.fromCodePoint(0x2460 + operation.order - 1) : `(${operation.order})`} ${line}`)) : group.instructions;
    return { ...group, instructions, items: assemblyDetailItems(model, plan, step, group, itemsCover) };
  });
  return manualDetailPageGroups(ctx, groups, copy).map((groups, continuationIndex) => ({ type: 'details', index, heading, groups, continuationIndex, countsMaterials: false }));
}

function directionLabel(group, copy) {
  const direction = group.renderDirection || assemblyDetailDirection(group);
  return direction[1] < 0 ? copy.viewBottom : direction[2] < 0 ? copy.viewBack : copy.viewFront;
}

function paintDetailRow(ctx, { group, left, right, location, icons, copy, y, height, fill }) {
  ctx.textBaseline = 'top'; ctx.fillStyle = INK; ctx.font = font(600, mm(MANUAL_TEXT_MM));
  group.titleLines.forEach((line, i) => ctx.fillText(line, mm(M), mm(y + i * 4.6)));
  ctx.textAlign = 'right'; ctx.font = font(500, mm(MANUAL_AUX_MM));
  ctx.fillText(directionLabel(group, copy), mm(PAGE_W - M), mm(y)); ctx.textAlign = 'left';
  const textY = y + group.titleLines.length * 4.6 + 1;
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  group.lines.forEach((line, i) => ctx.fillText(line, mm(M), mm(textY + i * 4.6)));
  const imgY = textY + group.lines.length * 4.6 + 2;
  const legendH = measureManualLegend(ctx, group.items, mm(245)).height / PX;
  const imgH = height - (imgY - y) - legendH - 6;
  const box = { x0: M, x1: 133.5, imgY, imgW: 124, imgH };
  paintPair(ctx, left.img, right.img, box, { front: copy.actionView, back: copy.completeView }, fill, left.marks, right.marks, true);
  drawArrows(ctx, left.img, mm(box.x0), mm(imgY), mm(box.imgW), mm(imgH), left.arrows);
  // 动作序号独立于材料圆圈，使用带方形底的①②③。
  const numbers = (left.operationNumbers || []).map(value => typeof value === 'number' ? value : value.order).filter(Number.isFinite);
  if (numbers.length) {
    ctx.font = font(600, mm(MANUAL_TEXT_MM)); ctx.fillStyle = INK;
    const labels = numbers.map(n => n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`).join('  ');
    const width = ctx.measureText(labels).width + mm(2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(mm(M + 2), mm(imgY + 1), width, mm(5));
    ctx.fillStyle = INK; ctx.fillText(labels, mm(M + 3), mm(imgY + 2));
  }
  const legendY = imgY + imgH + 2;
  const consumed = paintLegend(ctx, group.items, icons, mm(M), mm(legendY), mm(245), mm(y + height));
  if (consumed !== group.items.length) throw manualError('pagination', '局部材料参考绘制空间不足');
  if (location) {
    drawShot(ctx, location.img, mm(PAGE_W - M - 31), mm(imgY), mm(31), mm(26), fill);
    ctx.font = font(400, mm(MANUAL_AUX_MM)); ctx.fillStyle = MUTED;
    wrapManualText(ctx, copy.locationView, mm(31)).forEach((line, i) => ctx.fillText(line, mm(PAGE_W - M - 31), mm(imgY + 27 + i * 4)));
  }
}

function paintCompactDetail(ctx, { group, left, right, location, icons, copy, x, y, height, fill }) {
  const width = 138.5;
  ctx.fillStyle = INK; ctx.font = font(600, mm(MANUAL_TEXT_MM)); ctx.textBaseline = 'top';
  group.titleLines.forEach((line, i) => ctx.fillText(line, mm(x), mm(y + i * 4.6)));
  const textY = y + group.titleLines.length * 4.6 + 1;
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  group.lines.forEach((line, i) => ctx.fillText(line, mm(x), mm(textY + i * 4.6)));
  const imgY = textY + group.lines.length * 4.6 + 2;
  const imgH = (height - (imgY - y) - group.legendH - 4) / 2;
  drawShot(ctx, left.img, mm(x), mm(imgY), mm(width), mm(imgH), fill);
  drawMarks(ctx, left.img, mm(x), mm(imgY), mm(width), mm(imgH), left.marks, true);
  drawArrows(ctx, left.img, mm(x), mm(imgY), mm(width), mm(imgH), left.arrows);
  paintCaption(ctx, `${copy.actionView} · ${directionLabel(group, copy)}`, mm(x), mm(imgY), mm(imgH));
  const completeY = imgY + imgH + 2;
  drawShot(ctx, right.img, mm(x), mm(completeY), mm(width), mm(imgH), fill);
  drawMarks(ctx, right.img, mm(x), mm(completeY), mm(width), mm(imgH), right.marks, true);
  paintCaption(ctx, `${copy.completeView} · ${directionLabel(group, copy)}`, mm(x), mm(completeY), mm(imgH));
  const legendY = completeY + imgH + 2;
  paintDetailReferences(ctx, group.items, icons, mm(x), mm(legendY), mm(104.5));
  drawShot(ctx, location.img, mm(x + width - 31), mm(legendY), mm(31), mm(23), fill);
  ctx.font = font(400, mm(MANUAL_AUX_MM)); ctx.fillStyle = MUTED;
  wrapManualText(ctx, copy.locationView, mm(31)).forEach((line, i) => ctx.fillText(line, mm(x + width - 31), mm(legendY + 24 + i * 4)));
}

function manualError(code, message, diagnostics = []) {
  const error = new Error(message); error.code = code; error.diagnostics = diagnostics; return error;
}

/**
 * @param {{
 *   model?: object,
 *   modelJSON?: object,
 *   plan?: object,
 *   assemblyConfig?: object,
 *   order?: string,
 *   builder?: object,
 *   name: string,
 *   bom?: object | null,
 *   copy: Record<string, string>,
 *   filename?: string,
 *   save?: boolean,
 *   onDocument?: (result: {doc: object, blob: Blob, pages: number, plan: object}) => void | Promise<void>,
 *   onProgress?: (p: { page: number, total: number, phase?: string }) => void,
 *   stamp?: { url: string, host: string, hint: string } | null,
 * }} opts
 *
 * stamp 是方案页的网址和二维码（src/sharePage.ts），给了就印在每一页右下角。
 */
export async function exportAssemblyPdf(opts) {
  const { name, filename, onProgress, stamp, save = true, onDocument } = opts;
  // 在第一个异步等待之前冻结输入，编辑器切换模型或继续修改均不会进入本次导出。
  const snapshot = structuredClone(opts.modelJSON ?? opts.model.toJSON());
  const suppliedPlan = opts.plan ? structuredClone(opts.plan) : null;
  const copy = { actionView: '安装动作', completeView: '本步完成', regionOverview: '区域总览', regionShape: '独立外形', regionLocation: '成品定位', regionOrder: '拼接顺序', finalTitle: '完成造型与接口位置', instructionsTitle: '安装说明', ...manualSafetyCopy(), ...opts.copy };
  onProgress?.({ page: 0, total: 0, phase: 'resources' });
  await loadCatalog();
  const model = new BuildModel();
  const loaded = model.loadJSON(snapshot);
  if (!loaded.ok) throw manualError('model', `说明书模型无法载入: ${loaded.reason}`);
  const plan = suppliedPlan || computeAssemblyPlan(model, opts.assemblyConfig, opts.order || opts.builder?.assemblyOrder || 'y+');
  if (!plan.canExport) throw manualError('diagnostics', '模型连接诊断尚未通过，无法导出说明书', plan.diagnostics);
  const steps = plan.steps || [];
  if (!steps.length) throw manualError('empty', '模型没有可导出的装配步骤');
  await document.fonts?.ready;
  const itemsCover = coverItems(plan.bom || opts.bom || computeBOM(model));
  for (const item of itemsCover) item.instanceIds = [...new Set((plan.ledger?.instances || []).filter(row => row.group === item.kind && row.key === item.ledgerKey).flatMap(row => row.partIds))];
  const icons = await loadIcons(itemsCover);
  const coverLayout = legendChunks(itemsCover, true, icons, stamp);
  const descriptors = [{ type: 'cover', items: coverLayout.chunks[0], partsH: coverLayout.partsH }, ...coverLayout.chunks.slice(1).map(items => ({ type: 'legend', title: copy.bomTitle, items }))];
  descriptors.push({ type: 'safety', title: copy.safetyTitle, lines: instructionChunks([copy.safetyNotice, copy.safetySource, 'https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf'])[0] });
  descriptors.push({ type: 'overview' });
  for (const region of plan.regions || []) descriptors.push({ type: 'region', region });
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const heading = (copy.stepHeading || '{k}/{n} · {title}').replace('{k}', String(index + 1)).replace('{n}', String(steps.length)).replace('{kind}', kindLabel(step.kind, copy)).replace('{title}', step.title || '');
    const items = numberStepItems(stepItems(model, step), itemsCover);
    const { chunks, partsH } = legendChunks(items, false, icons, stamp);
    const instructions = step.instructions || [];
    const measurement = newPageCanvas();
    const contextHint = step.action?.layer ? copy.layerHint : ['frame', 'risers', 'panels'].includes(step.kind) ? copy.bodyHint : step.action?.type === 'preassemble' ? copy.preassemblyHint : copy.contextHint;
    const textLayout = manualStepTextLayout(measurement.ctx, heading, instructions, contextHint || '');
    descriptors.push({ type: 'step', index, heading, items: chunks[0], allItems: items, partsH, instructions, ...textLayout });
    descriptors.push(...chunks.slice(1).map(items => ({ type: 'legend', title: `${heading} · ${copy.thisStep}`, items })));
    descriptors.push(...manualStepDetailDescriptors(measurement.ctx, model, plan, index, itemsCover, copy));
    measurement.c.width = measurement.c.height = 0;
    for (let offset = 0; offset < textLayout.remainingLines.length; offset += 35) descriptors.push({ type: 'instructions', title: `${heading} · ${copy.instructionsTitle}`, lines: textLayout.remainingLines.slice(offset, offset + 35) });
  }
  descriptors.push({ type: 'final' });
  const textMeasurement = newPageCanvas();
  for (let position = 0; position < descriptors.length; position++) {
    const descriptor = descriptors[position];
    if (!['region', 'overview', 'final'].includes(descriptor.type)) continue;
    const region = descriptor.region;
    const heading = region ? `${region.label || `R${plan.regions.indexOf(region) + 1}`} · ${region.name}` : descriptor.type === 'final' ? copy.finalTitle : copy.regionOverview;
    const instructions = region ? [`${copy.regionOrder}: ${steps.filter(step => step.regionId === region.id).map(step => step.title).filter(Boolean).join(' → ')}`]
      : descriptor.type === 'overview' ? [(plan.regions || []).map((region, i) => `${region.label || `R${i + 1}`} · ${region.name}`).join('   ')]
      : [(plan.interfaces || []).filter(marker => marker.attachment !== 'upper-frame').map(marker => `I${marker.id.split('-').at(-1)}`).join(' · ')];
    const layout = manualStepTextLayout(textMeasurement.ctx, heading, instructions);
    Object.assign(descriptor, layout);
    const continuations = [];
    for (let offset = 0; offset < layout.remainingLines.length; offset += 35) continuations.push({ type: 'instructions', title: `${heading} · ${copy.instructionsTitle}`, lines: layout.remainingLines.slice(offset, offset + 35) });
    descriptors.splice(position + 1, 0, ...continuations); position += continuations.length;
  }
  textMeasurement.c.width = textMeasurement.c.height = 0;
  const total = descriptors.length;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;height:720px;pointer-events:none';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  let scene;
  let activeState = null;
  let currentPage = 0;
  const coverCopy = { ...copy, modelName: name || copy.product || 'design', stepsLine: String(copy.stepsLine || '').replaceAll('{n}', String(steps.length)) };
  try {
    scene = new SceneManager(host);
    scene.setMotion(false); scene.setTheme(false); scene.setScene(false);
    const tune = loadTune(); applyFrameHex(tune.frame); scene.applyColorTune(tune);
    scene.controls.enabled = false;
    scene.onMeshesReady = () => scene.renderModel(model, null, { assembly: activeState });
    scene.renderModel(model, null);
    if (!await waitSceneReady(scene)) throw manualError('resources', '零件网格载入超时');
    const failedMeshes = ['_connMeshes', '_tubeMeshes', '_fitMeshes', '_surfMeshes', '_slideMeshes'].filter(key => scene[key] === false);
    if (failedMeshes.length) throw manualError('resources', `真实零件网格载入失败: ${failedMeshes.join(', ')}`);
    scene.renderModel(model, null);
    const fullBounds = renderedBounds(scene, model);
    const allIds = new Set(['nodes', 'tubes', 'panels', 'clamps', 'textiles', 'slides', 'fittings'].flatMap(key => [...(model[key]?.keys() || [])]));
    const shot = async (state, yaw, items = [], bounds = null, direction = null, box = stepBox(), local = false) => {
      activeState = state; scene.renderModel(model, null, { assembly: state });
      const size = snapSize(box.imgW, box.imgH);
      const visibleItems = local ? items : items.slice(0, 6);
      const image = await captureView(scene, model, yaw, { ...size, bounds: bounds || renderedBounds(scene, model), items: positionedItems(model, visibleItems, state), oneEach: true, direction });
      if (!local) image.marks.push(...projectStateMarks(scene, state, size.width / size.height));
      image.operationNumbers = state?.operationNumbers || [];
      image.arrows = (state?.arrows || []).map(arrow => {
        const [from, to] = scene.projectWorld([arrow.from, arrow.to], size.width / size.height);
        const operation = state?.operationNumbers?.find(value => value.id === arrow.id);
        return from && to ? { from, to, order: operation?.order } : null;
      }).filter(Boolean);
      return image;
    };
    for (const descriptor of descriptors) {
      currentPage++;
      onProgress?.({ page: currentPage, total, phase: 'render' });
      await yieldUi();
      const { c, ctx } = newPageCanvas();
      const pageBox = descriptor.type === 'cover' ? coverBox(descriptor.partsH) : stepBox(descriptor.partsH, descriptor.headerH);
      try {
        if (descriptor.type === 'legend') {
          paintTextPage(ctx, descriptor.title, [], stamp);
          paintLegend(ctx, descriptor.items, icons, mm(M), mm(17), mm(PAGE_W - M * 2) - (stamp ? stampWidth(ctx, stamp, STAMP_QR_STEP, false) + mm(STAMP_GAP) : 0), mm(PAGE_H - M));
        } else if (descriptor.type === 'instructions' || descriptor.type === 'safety') paintTextPage(ctx, descriptor.title, descriptor.lines, stamp);
        else if (descriptor.type === 'details') {
          paintTextPage(ctx, `${descriptor.heading} · ${copy.detailTitle}`, [], stamp);
          ctx.font = font(400, mm(MANUAL_AUX_MM)); ctx.fillStyle = MUTED;
          ctx.fillText(`${copy.detailReference}${descriptor.continuationIndex ? ` · ${copy.continuation}` : ''}`, mm(M), mm(11));
          for (let groupIndex = 0; groupIndex < descriptor.groups.length; groupIndex++) {
            const group = descriptor.groups[groupIndex];
            const height = 173;
            const state = assemblyDetailState(plan, descriptor.index, group.id, { action: true });
            const completed = assemblyDetailState(plan, descriptor.index, group.id, { action: false });
            scene.renderModel(model, null, { assembly: state }); const beforeBounds = assemblyDetailBounds(scene, model, plan, steps[descriptor.index], state);
            scene.renderModel(model, null, { assembly: completed }); const afterBounds = assemblyDetailBounds(scene, model, plan, steps[descriptor.index], completed);
            const bounds = unionBounds(beforeBounds, afterBounds);
            const imageHeight = group.compact ? (height - (group.titleLines.length * 4.6 + group.lines.length * 4.6 + 3) - group.legendH - 4) / 2 : height - (group.height - 46);
            const box = { imgW: group.compact ? 138.5 : 124, imgH: imageHeight };
            const direction = assemblyDetailDirection(group, steps[descriptor.index]);
            group.renderDirection = direction;
            const left = await shot(state, 0, group.items, bounds, direction, box, true);
            const right = await shot(completed, 0, group.items, bounds, direction, box, true);
            const locationState = assemblyState(plan, descriptor.index, { action: false });
            locationState.current = new Set(group.partIds); locationState.done = new Set([...locationState.visible].filter(id => !locationState.current.has(id)));
            const location = await shot(locationState, 0, [], fullBounds, [1, 0.65, 1], { imgW: 31, imgH: 26 }, true);
            if (group.compact) paintCompactDetail(ctx, { group, left, right, location, icons, copy, x: M + groupIndex * 144.5, y: 20, height, fill: sceneFill(scene) });
            else paintDetailRow(ctx, { group, left, right, location, icons, copy, y: 20, height, fill: sceneFill(scene) });
          }
        }
        else if (descriptor.type === 'cover') {
          const front = await shot(null, 0, [], fullBounds, null, pageBox), back = await shot(null, Math.PI, [], fullBounds, null, pageBox);
          const consumed = paintCover(ctx, { front: front.img, back: back.img, copy: coverCopy, items: descriptor.items, icons, fill: sceneFill(scene), stamp, partsH: descriptor.partsH });
          if (consumed !== descriptor.items.length) throw manualError('pagination', '总料表分页与实际绘制不一致');
        } else {
          let state, completed, heading, instructions = [], leftLabel = copy.actionView, rightLabel = copy.completeView, bounds, leftFocus, rightFocus, roofCoverDetail = false, modulePreassembly = false, layer = false, bodyContext = false;
          if (descriptor.type === 'step' || descriptor.type === 'detail') {
            state = assemblyState(plan, descriptor.index, { action: true }); completed = assemblyState(plan, descriptor.index, { action: false });
            state = assemblyPresentationState(model, plan, steps[descriptor.index], state, { detail: descriptor.type === 'detail' });
            completed = assemblyPresentationState(model, plan, steps[descriptor.index], completed, { detail: descriptor.type === 'detail' });
            if (descriptor.type === 'step' && state.actionStage === 'before' && !state.arrows?.length) leftLabel = copy.beforeView || copy.actionView;
            modulePreassembly = steps[descriptor.index].action?.scope === 'parts' && steps[descriptor.index].action.type === 'preassemble';
            layer = !!steps[descriptor.index].action?.layer;
            bodyContext = descriptor.type === 'step' && ['frame', 'risers', 'panels'].includes(steps[descriptor.index].kind);
            if (layer) { leftLabel = copy.layerAction || copy.actionView; rightLabel = copy.layerComplete || copy.completeView; }
            if (modulePreassembly) {
              leftLabel = copy.preassemblyBefore || copy.beforeView || copy.actionView;
              rightLabel = copy.preassemblyComplete || copy.completeView;
            }
            heading = descriptor.heading; instructions = descriptor.instructions;
            if (descriptor.type === 'detail') {
              const interfaces = state.interfaceMarks || [];
              const points = interfaces.map(marker => marker.position).filter(Boolean);
              const sources = interfaces.map(marker => state.arrows.find(arrow => arrow.id === marker.id)?.from || marker.position).filter(Boolean);
              const focus = positions => boundsFor([0, 1, 2].map(axis => Math.min(...positions.map(p => p[axis])) - 22), [0, 1, 2].map(axis => Math.max(...positions.map(p => p[axis])) + 22));
              if (points.length) { leftFocus = focus([...sources, ...points]); rightFocus = focus(points); }
              roofCoverDetail = steps[descriptor.index].slideIds?.some(id => model.slides.get(id)?.kind === 'roof2') || plan.regions.find(r => r.id === steps[descriptor.index].regionId)?.accessoryType === 'roof-cover';
              if (roofCoverDetail) {
                // A canopy covers its supporting roof from above. Show the
                // underside and the complete referenced support instead.
                scene.renderModel(model, null, { assembly: state });
                leftFocus = assemblyFocusBounds(scene, model, plan, steps[descriptor.index], state);
                scene.renderModel(model, null, { assembly: completed });
                rightFocus = assemblyFocusBounds(scene, model, plan, steps[descriptor.index], completed);
              }
            }
          } else if (descriptor.type === 'region') {
            const regionIds = new Set(descriptor.region.partIds);
            state = { current: regionIds, done: new Set(), visible: regionIds, transforms: new Map() };
            completed = { current: regionIds, done: allIds, visible: allIds, transforms: new Map() };
            heading = `${descriptor.region.label || `R${plan.regions.indexOf(descriptor.region) + 1}`} · ${descriptor.region.name}`;
            leftLabel = copy.regionShape; rightLabel = copy.regionLocation;
            instructions = [`${copy.regionOrder}: ${steps.filter(step => step.regionId === descriptor.region.id).map(step => step.title).filter(Boolean).join(' → ')}`];
          } else {
            const finalInterfaces = (plan.interfaces || []).filter(marker => marker.attachment !== 'upper-frame');
            state = descriptor.type === 'final' ? { current: allIds, done: new Set(), visible: allIds, transforms: new Map(), interfaceMarks: finalInterfaces, arrows: [] } : null;
            completed = state;
            heading = descriptor.type === 'final' ? copy.finalTitle : copy.regionOverview;
            leftLabel = copy.front; rightLabel = copy.back;
            instructions = descriptor.type === 'overview' ? (plan.regions || []).map((region, i) => `${region.label || `R${i + 1}`} · ${region.name}`).join('   ') : finalInterfaces.map(marker => `I${marker.id.split('-').at(-1)}`).join(' · ');
            instructions = [instructions];
            bounds = fullBounds;
          }
          if (descriptor.type === 'step') {
            scene.renderModel(model, null, { assembly: state });
            const leftBounds = assemblyFocusBounds(scene, model, plan, steps[descriptor.index], state);
            scene.renderModel(model, null, { assembly: completed });
            const rightBounds = assemblyFocusBounds(scene, model, plan, steps[descriptor.index], completed);
            bounds = boundsFor(leftBounds.min.map((value, axis) => Math.min(value, rightBounds.min[axis])), leftBounds.max.map((value, axis) => Math.max(value, rightBounds.max[axis])));
          }
          const isReverse = descriptor.type === 'detail' || descriptor.type === 'overview' || descriptor.type === 'final';
          const left = await shot(state, descriptor.type === 'detail' ? Math.PI : 0, descriptor.allItems || descriptor.items || [], leftFocus || bounds, roofCoverDetail ? [1, -0.65, 1] : null, pageBox);
          const right = await shot(completed, isReverse ? Math.PI : 0, descriptor.allItems || descriptor.items || [], rightFocus || bounds, roofCoverDetail ? [-1, -0.65, -1] : null, pageBox);
          if (descriptor.type === 'overview') {
            for (const [image, yaw] of [[left, 0], [right, Math.PI]]) {
              scene.frameFromYaw(model, yaw, { silent: true, bounds: fullBounds, aspect: image.img.width / image.img.height, margin: FIT });
              const centers = (plan.regions || []).map(region => centroid(region.partIds.map(id => partCenter(model, id)).filter(Boolean)));
              const positions = scene.projectWorld(centers.filter(Boolean), image.img.width / image.img.height);
              image.marks.push(...positions.map((point, i) => ({ ...point, num: plan.regions[i]?.label || `R${i + 1}` })));
            }
          }
          const consumed = paintStep(ctx, { front: left.img, back: right.img, copy: { ...copy, front: leftLabel, back: rightLabel, contextHint: layer ? copy.layerHint : bodyContext ? copy.bodyHint : modulePreassembly ? copy.preassemblyHint : roofCoverDetail ? copy.roofCoverHint : ['step', 'detail'].includes(descriptor.type) ? copy.contextHint : '' }, heading, items: descriptor.items || [], icons, k: currentPage, n: total, fill: sceneFill(scene), frontMarks: left.marks, backMarks: right.marks, instructions, stamp, partsH: descriptor.partsH, headerH: descriptor.headerH, instructionLines: descriptor.instructionLines });
          if (consumed !== (descriptor.items?.length || 0)) throw manualError('pagination', '步骤料表分页与实际绘制不一致');
          const box = pageBox;
          if (descriptor.type !== 'detail') drawArrows(ctx, left.img, mm(box.x0), mm(box.imgY), mm(box.imgW), mm(box.imgH), left.arrows);
        }
        ctx.fillStyle = MUTED; ctx.font = font(400, mm(2)); ctx.textAlign = 'center';
        ctx.fillText(`${currentPage} / ${total}`, mm(PAGE_W / 2), mm(PAGE_H - 2.5));
        await pageToPdf(doc, c, currentPage === 1);
        if (descriptor.type === 'safety') doc.link(M, 28, 150, 10, { url: 'https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf' });
      } finally { c.width = c.height = 0; }
    }
    if (doc.getNumberOfPages() !== total) throw manualError('pagination', '说明书页数与导出进度不一致');
    const blob = doc.output('blob');
    await onDocument?.({ doc, blob, pages: total, plan });
    if (save) doc.save(filename || `${name || 'design'}.pdf`);
    onProgress?.({ page: total, total, phase: 'complete' });
    return { pages: total, coverRows: itemsCover.length, steps: steps.length, diagnostics: plan.diagnostics, missingPictures: itemsCover.filter(item => !partImageSrc(item.id)).map(item => item.id), blob };
  } catch (error) {
    error.page = currentPage; error.total = total;
    throw error;
  } finally {
    if (scene) { scene.onMeshesReady = () => {}; scene.dispose(); scene.renderer.forceContextLoss(); }
    host.remove();
  }
}
