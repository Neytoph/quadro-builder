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
import { createAssemblyReadingPlan, assemblyReadingState, readingModuleDirection } from './assemblyReadingPlan.js';
import { loadAssemblyPartImage } from '../ui/assemblyPartImages';

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

/** Local locator has its own column; neither model image is painted underneath it. */
export function manualReadingPageBox(partsH = 47, headerH = 20, localized = false) {
  const box = stepBox(partsH, headerH);
  if (!localized) return box;
  const imgW = box.imgW - 19;
  return { ...box, imgW, x1: M + imgW + box.gap, locator: { x: PAGE_W - M - 35, y: Math.max(20, headerH + 2), width: 35, height: 29 } };
}

function coverBox(bomH = 54) {
  const gap = 2.5;
  const headerH = 22;
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

function drawShot(ctx, img, x, y, w, h, fill, contain = false) {
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2));
  ctx.clip();
  ctx.fillStyle = fill || WELL;
  ctx.fillRect(x, y, w, h);
  if (img && img.width) {
    const s = contain ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
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
      y: radius + 3 + (height - 2 * (radius + 3)) * (index + 1) / (rows.length + 1) }));
  }
  return placed;
}

/** Keep number boxes outside actual projected motion; never change arrow endpoints.
 * @param {any[]} marks
 * @param {number} width
 * @param {number} height
 * @param {{arrows?:any[],materialMarks?:any[],gap?:number,arrowClearance?:number,padding?:number,blockedRects?:any[]}} options
 */
export function layoutOperationCallouts(marks, width, height, options = {}) {
  const { arrows = [], materialMarks = [], gap = 6, arrowClearance = 6, padding = 3, blockedRects = [] } = options;
  const placed = [];
  const intersectsMotion = (box, arrow) => {
    // Slab intersection of the complete shaft/head clearance with a number box.
    const limits = [[box.x - box.boxWidth / 2 - arrowClearance, box.x + box.boxWidth / 2 + arrowClearance],
      [box.y - box.boxHeight / 2 - arrowClearance, box.y + box.boxHeight / 2 + arrowClearance]];
    let lo = 0, hi = 1;
    for (const [axis, from, to] of [[0, arrow.x1, arrow.x2], [1, arrow.y1, arrow.y2]]) {
      const delta = to - from, [min, max] = limits[axis];
      if (Math.abs(delta) < 1e-9) { if (from < min || from > max) return false; }
      else {
        const a = (min - from) / delta, b = (max - from) / delta;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
        if (lo > hi) return false;
      }
    }
    return true;
  };
  const overlapsBox = (box, other) => Math.abs(box.x - other.x) < (box.boxWidth + other.boxWidth) / 2 + gap &&
    Math.abs(box.y - other.y) < (box.boxHeight + other.boxHeight) / 2 + gap;
  const overlapsMaterial = (box, mark) => Math.hypot(Math.max(0, Math.abs(mark.x - box.x) - box.boxWidth / 2),
    Math.max(0, Math.abs(mark.y - box.y) - box.boxHeight / 2)) < (mark.radius ?? 12) + gap;
  for (const mark of marks) {
    const boxWidth = mark.boxWidth ?? 26, boxHeight = mark.boxHeight ?? 26;
    const minX = padding + boxWidth / 2, maxX = width - padding - boxWidth / 2;
    const minY = padding + boxHeight / 2, maxY = height - padding - boxHeight / 2;
    const fitsViewport = minX <= maxX && minY <= maxY;
    const clamp = (x, y) => ({ x: minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : width / 2,
      y: minY <= maxY ? Math.max(minY, Math.min(maxY, y)) : height / 2, boxWidth, boxHeight });
    const candidates = [];
    for (const arrow of arrows) {
      const dx = arrow.x2 - arrow.x1, dy = arrow.y2 - arrow.y1, length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length, ny = dx / length;
      const offset = Math.abs(nx) * boxWidth / 2 + Math.abs(ny) * boxHeight / 2 + arrowClearance + gap;
      for (const t of [0.5, 0, 1]) for (const sign of [-1, 1]) {
        candidates.push(clamp(arrow.x1 + dx * t + nx * offset * sign, arrow.y1 + dy * t + ny * offset * sign));
      }
    }
    for (const distance of [boxHeight / 2 + arrowClearance + gap, boxWidth + gap, 2 * (boxWidth + gap)]) {
      for (let angle = 0; angle < 8; angle++) candidates.push(clamp(mark.x + Math.cos(angle * Math.PI / 4) * distance, mark.y + Math.sin(angle * Math.PI / 4) * distance));
    }
    // Dense drawings still get a deterministic bounded search, rather than a clipped label.
    const stride = Math.max(6, Math.min(boxWidth, boxHeight) / 2);
    for (let y = minY; y <= maxY; y += stride) for (let x = minX; x <= maxX; x += stride) candidates.push({ x, y, boxWidth, boxHeight });
    candidates.sort((a, b) => Math.hypot(a.x - mark.x, a.y - mark.y) - Math.hypot(b.x - mark.x, b.y - mark.y));
    const collisionCount = box => arrows.filter(arrow => intersectsMotion(box, arrow)).length +
      [...placed, ...blockedRects].filter(other => overlapsBox(box, other)).length + materialMarks.filter(other => overlapsMaterial(box, other)).length;
    let box = fitsViewport ? candidates.find(candidate => !collisionCount(candidate)) : null;
    const placementClear = !!box;
    if (!box) box = candidates.reduce((best, candidate) => collisionCount(candidate) < collisionCount(best) ? candidate : best, clamp(mark.x, mark.y));
    placed.push({ ...mark, ...box, anchorX: mark.x, anchorY: mark.y, placementClear });
  }
  return placed;
}

function projectedManualMarks(img, x, y, w, h, marks, local) {
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  const ox = (w - dw) / 2, oy = (h - dh) / 2, r = mm(2.8);
  const source = marks.map(mark => ({ x: ox + mark.u * dw, y: oy + mark.v * dh, label: String(mark.num), z: mark.z }))
    .filter(mark => mark.x > -r && mark.x < w + r && mark.y > -r && mark.y < h + r).sort((a, b) => a.z - b.z);
  const labels = local ? layoutManualCallouts(source, w, h, r) : layoutAssemblyMarks(source, w, h, { radius: r, gap: r * 0.15 });
  return labels.map(mark => ({ ...mark, x: x + mark.x, y: y + mark.y, anchorX: x + mark.anchorX, anchorY: y + mark.anchorY, radius: r }));
}

function drawMarks(ctx, img, x, y, w, h, marks, local = false) {
  if (!img || !img.width || !marks || !marks.length) return;
  const r = mm(2.8);
  const labels = projectedManualMarks(img, x, y, w, h, marks, local);
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2));
  ctx.clip();
  for (const m of labels) {
    if (Math.hypot(m.x - m.anchorX, m.y - m.anchorY) > 1) {
      ctx.beginPath(); ctx.moveTo(m.anchorX, m.anchorY); ctx.lineTo(m.x, m.y);
      ctx.strokeStyle = 'rgba(92,101,112,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    drawBadge(ctx, m.x, m.y, m.label, r);
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

async function iconImage(item) {
  const key = await loadAssemblyPartImage(item);
  if (iconCache.has(key)) return iconCache.get(key);
  const img = await loadImage(key);
  iconCache.set(key, img);
  return img;
}

async function loadIcons(items) {
  const map = new Map();
  await Promise.all(items.map(async (it) => {
    map.set(it.num, await iconImage(it));
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

async function captureView(scene, model, yaw, { bounds, width, height, items, oneEach, direction, fitMargin = null }) {
  const aspect = width / height;
  scene._viewSize = { w: width, h: height };
  try {
    if (direction) scene._frameAlong(model, new Vector3(...direction).normalize(), { silent: true, bounds, aspect, margin: fitMargin || 1.18 });
    else scene.frameFromYaw(model, yaw, { silent: true, bounds, aspect, margin: fitMargin || FIT });
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

export function projectReadingLocatorBounds(scene, bounds, aspect, padding = .025) {
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) corners.push([x, y, z]);
  const points = scene.projectWorld(corners, aspect);
  const complete = points.length === 8 && points.every(point => point && Number.isFinite(point.u) && Number.isFinite(point.v) && point.u >= padding && point.u <= 1 - padding && point.v >= padding && point.v <= 1 - padding);
  return { points, complete, padding, aspect };
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
  const minRowH = mm(12);
  const numW = mm(8);
  const dotW = 0;
  const iconW = mm(12);
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
    const rowH = Math.max(minRowH, ...wrapped.slice(offset, offset + cols).map(lines => lines.length * mm(4.4) + mm(3)));
    rows.push({ offset, rowH });
  }
  return { cols, colW, colGap, numW, dotW, iconW, qtyColW, wrapped, rows, height: rows.reduce((sum, row) => sum + row.rowH, 0) };
}

function paintLegend(ctx, items, icons, x, y, maxW, maxY) {
  if (!items.length) return 0;
  const { cols, colW, colGap, numW, dotW, iconW, qtyColW, wrapped, rows } = measureManualLegend(ctx, items, maxW);
  const badgeR = mm(2.8), iconS = mm(10);
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
  ctx.font = font(400, mm(MANUAL_AUX_MM));
  if (copy.readingPhysicalStatus) ctx.fillText(copy.readingPhysicalStatus, mm(M), mm(15));
  paintPair(ctx, front, back, box, copy, fill, frontMarks, backMarks);

  const bomY = box.imgY + box.imgH + 1.5;
  const stampW = stamp ? paintStamp(ctx, stamp, STAMP_QR_COVER, true) : 0;
  ctx.fillStyle = ACCENT;
  ctx.font = font(600, mm(3.2));
  ctx.fillText(copy.bomTitle, mm(M), mm(bomY));
  return paintLegend(ctx, items, icons, mm(M), mm(bomY + 4.2), mm(PAGE_W - M * 2) - stampW, mm(PAGE_H - 3)) || 0;
}

function paintStep(ctx, { front, back, copy, heading, items, icons, k, n, fill, frontMarks, backMarks, stamp, instructions = [], partsH, headerH = 20, instructionLines = null, imageBox = null }) {
  const box = imageBox || stepBox(partsH, headerH);
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
  // Keep the full page raster and fonts; reduce codec overhead for long manuals.
  const jpeg = canvas.toDataURL("image/jpeg", 0.90);
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

/** Region pages describe their remaining physical parts after scheduling.
 * Keep original configuration labels; virtual tube topology alone has no mesh.
 */
export function manualRegionDescriptors(model, plan) {
  const hasPhysicalPart = id => {
    if (['nodes', 'panels', 'textiles', 'slides', 'fittings', 'clamps'].some(key => model[key]?.has(id))) return true;
    const tube = model.tubes?.get(id);
    return !!tube && !tube.arm && !tube.link;
  };
  return (plan.regions || []).flatMap((region, index) => {
    const partIds = [...new Set((region.partIds || []).filter(hasPhysicalPart))];
    return partIds.length ? [{ type: 'region', region, partIds, label: region.label || `R${index + 1}` }] : [];
  });
}

export function projectOperationMarks(scene, model, state, aspect) {
  return (state?.operationNumbers || []).map(operation => {
    const positions = positionedItems(model, [{ instanceIds: operation.partIds, key: operation.id }], state)[0]?.positions || [];
    const point = scene.projectWorld(positions, aspect).find(value => value && value.u >= 0 && value.u <= 1 && value.v >= 0 && value.v <= 1);
    return point ? { ...point, order: operation.order } : null;
  }).filter(Boolean);
}

/** Current connector bodies in this rendered pose. u/v are the rectangle centre;
 * width/height are normalized to the same camera/aspect as the image.
 * @param {number | null} [aspect]
 */
export function projectConnectorCalloutRects(scene, model, state, aspect = null) {
  if (!state?.current?.size || !state?.visible) return [];
  const rectangles = [];
  for (const row of scene._indexParts(scene.buildGroup.children).values()) {
    if (!model.nodes.has(row.id) || !state.current.has(row.id) || !state.visible.has(row.id)) continue;
    // _piecesBox already includes the actual instance/world pose; applying the
    // assembly translation again would protect a different position.
    const box = scene._piecesBox(row.pieces);
    if (!box || ![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) continue;
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push([x, y, z]);
    const points = scene.projectWorld(corners, aspect).filter(point => point && Number.isFinite(point.u) && Number.isFinite(point.v));
    if (!points.length) continue;
    const minU = Math.min(...points.map(point => point.u)), maxU = Math.max(...points.map(point => point.u));
    const minV = Math.min(...points.map(point => point.v)), maxV = Math.max(...points.map(point => point.v));
    rectangles.push({ id: row.id, u: (minU + maxU) / 2, v: (minV + maxV) / 2, width: maxU - minU, height: maxV - minV });
  }
  return rectangles;
}

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

/** Arrowhead uses the true projected tip, and fits inside even a short motion. */
export function projectedOperationArrowHead(arrow, maxLength = 12) {
  const dx = arrow.x2 - arrow.x1, dy = arrow.y2 - arrow.y1, distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return null;
  const angle = Math.atan2(dy, dx), length = Math.min(maxLength, distance);
  return { tip: [arrow.x2, arrow.y2], left: [arrow.x2 - length * Math.cos(angle - 0.45), arrow.y2 - length * Math.sin(angle - 0.45)],
    right: [arrow.x2 - length * Math.cos(angle + 0.45), arrow.y2 - length * Math.sin(angle + 0.45)] };
}

/** @param {any[] | null} [operationMarks]
 * @param {any[]} [connectorCalloutRects]
 */
export function drawManualArrows(ctx, img, x, y, w, h, arrows, marks = [], local = false, operationMarks = null, connectorCalloutRects = []) {
  if (!arrows?.length && !operationMarks?.length) return;
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  const ox = (w - dw) / 2, oy = (h - dh) / 2;
  const projected = (arrows || []).map(arrow => ({ ...arrow, x1: ox + arrow.from.u * dw, y1: oy + arrow.from.v * dh,
    x2: ox + arrow.to.u * dw, y2: oy + arrow.to.v * dh }));
  const materialMarks = projectedManualMarks(img, 0, 0, w, h, marks, local);
  ctx.font = font(600, mm(MANUAL_TEXT_MM));
  const labelSources = operationMarks === null ? projected.filter(arrow => arrow.order).map(arrow => ({ x: arrow.x1, y: arrow.y1, order: arrow.order })) :
    operationMarks.map(mark => ({ x: ox + mark.u * dw, y: oy + mark.v * dh, order: mark.order }));
  const labels = layoutOperationCallouts(labelSources.map(mark => {
    const label = mark.order <= 20 ? String.fromCodePoint(0x2460 + mark.order - 1) : `(${mark.order})`;
    return { x: mark.x, y: mark.y, label, boxWidth: Math.max(mm(5), ctx.measureText(label).width + mm(2)), boxHeight: mm(5) };
  }), w, h, { arrows: projected, materialMarks, gap: mm(0.8), arrowClearance: mm(2), padding: mm(1),
    blockedRects: [{ x: w / 2, y: h - mm(5), boxWidth: w, boxHeight: mm(10) },
      ...connectorCalloutRects.map(rect => ({ x: ox + rect.u * dw, y: oy + rect.v * dh, boxWidth: rect.width * dw, boxHeight: rect.height * dh }))] });
  ctx.save();
  roundRect(ctx, x, y, w, h, mm(1.2)); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Draw thin number leaders first so they cannot paint over movement arrows.
  for (const box of labels) {
    ctx.beginPath(); ctx.moveTo(x + box.anchorX, y + box.anchorY); ctx.lineTo(x + box.x, y + box.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = mm(0.65); ctx.stroke();
    ctx.strokeStyle = INK; ctx.lineWidth = mm(0.25); ctx.stroke();
  }
  for (const arrow of projected) {
    const from = [x + arrow.x1, y + arrow.y1], to = [x + arrow.x2, y + arrow.y2];
    // A motion parallel to the camera has no 2D length; do not invent a direction.
    const head = projectedOperationArrowHead(arrow, mm(3));
    if (!head) continue;
    ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = mm(1.8); ctx.stroke();
    ctx.strokeStyle = '#b33d00'; ctx.lineWidth = mm(0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...to);
    ctx.lineTo(x + head.left[0], y + head.left[1]);
    ctx.lineTo(x + head.right[0], y + head.right[1]);
    ctx.closePath(); ctx.strokeStyle = '#fff'; ctx.lineWidth = mm(1.1); ctx.stroke();
    ctx.fillStyle = '#b33d00'; ctx.fill();
  }
  for (const box of labels) {
    ctx.fillStyle = '#fff'; ctx.fillRect(x + box.x - box.boxWidth / 2, y + box.y - box.boxHeight / 2, box.boxWidth, box.boxHeight);
    ctx.strokeStyle = INK; ctx.lineWidth = mm(0.25); ctx.strokeRect(x + box.x - box.boxWidth / 2, y + box.y - box.boxHeight / 2, box.boxWidth, box.boxHeight);
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(box.label, x + box.x, y + box.y);
  }
  ctx.restore();
}

export function manualActionLabelBox(ctx, order, from, rect) {
  const label = order <= 20 ? String.fromCodePoint(0x2460 + order - 1) : `(${order})`;
  ctx.font = font(600, mm(MANUAL_TEXT_MM));
  const width = Math.max(mm(5), ctx.measureText(label).width + mm(2)), height = mm(5);
  const x = Math.max(rect.x + width / 2 + mm(1), Math.min(rect.x + rect.w - width / 2 - mm(1), from[0]));
  const y = Math.max(rect.y + height / 2 + mm(1), Math.min(rect.y + rect.h - mm(9), from[1] - mm(4)));
  return { label, x, y, width, height };
}

export function manualPartsHeight(ctx, items, maxW, cover = false) {
  const height = measureManualLegend(ctx, items, maxW).height / PX;
  // 六行短表完整留在图示页，图示至少保留 85 mm 高度。
  // 更长的表保留较大图示，并让续页包含多行物料。
  const maxHeight = height <= 100 ? (cover ? 106 : 102) : (cover ? 91 : 82);
  return Math.min(maxHeight, Math.max(cover ? 54 : 47, Math.ceil(height + 6)));
}

export function manualLegendChunks(items, cover, icons, stamp, title = '') {
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
    const y = chunks.length ? mm(manualTextPageLayout(ctx, title, [], stamp).bodyY) : mm(box.imgY + box.imgH + (cover ? 5.7 : 5.2));
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
  const layout = manualTextPageLayout(ctx, title, lines, stamp);
  if (layout.lines.length > layout.capacity) throw manualError('pagination', '正文续页超过安全打印区域');
  ctx.fillStyle = INK; ctx.font = font(600, mm(4.4)); ctx.textBaseline = 'top';
  layout.titleLines.forEach((line, i) => ctx.fillText(line, mm(M), mm(5 + i * 5.4)));
  if (stamp) paintStamp(ctx, stamp, STAMP_QR_STEP, false);
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  layout.lines.forEach((line, i) => ctx.fillText(line, mm(M), mm(layout.bodyY + i * 5)));
}

/** @param {any | null} [stamp] */
export function manualTextPageLayout(ctx, title, lines, stamp = null) {
  ctx.font = font(600, mm(4.4));
  const titleLines = wrapManualText(ctx, title, mm(PAGE_W - M * 2));
  const bodyY = Math.max(18, 7 + titleLines.length * 5.4);
  const stampTop = PAGE_H - 2.5 - 2.3 - 0.8 - STAMP_QR_STEP;
  const bodyBottom = stamp ? stampTop - 2 : PAGE_H - M;
  const capacity = Math.floor((bodyBottom - bodyY - MANUAL_TEXT_MM) / 5) + 1;
  if (capacity < 1) throw manualError('pagination', '正文续页标题超过单页容量');
  ctx.font = font(400, mm(MANUAL_TEXT_MM));
  return { titleLines, bodyY, bodyBottom, capacity, lines: lines.flatMap(line => wrapManualText(ctx, line, mm(PAGE_W - M * 2))) };
}

function manualTextDescriptors(ctx, title, lines, stamp) {
  const layout = manualTextPageLayout(ctx, title, lines, stamp), descriptors = [];
  for (let offset = 0; offset < layout.lines.length; offset += layout.capacity) descriptors.push({ type: 'instructions', title, lines: layout.lines.slice(offset, offset + layout.capacity) });
  return descriptors;
}

function manualSafetyCopy(lang = getLang()) {
  if (lang === 'de') return { safetyTitle: 'Vor dem Aufbau', safetyNotice: 'Teile zuerst anhand der Gesamtstückliste zählen und nach Länge und Farbe sortieren. Nach dem vollständigen Zusammenstecken von unten nach oben verschrauben. An Plattenpositionen Plattenschrauben verwenden. Vor der Benutzung die offizielle Sicherheitsanweisung beachten.', safetySource: 'Offizielle Sicherheitsanweisung', detailTitle: 'Lokale Montageschritte', detailReference: 'Materialnummern: Mengen sind im Hauptschritt enthalten.', locationView: 'Position im Modell', viewFront: 'Vorderseite', viewBack: 'Rückseite', viewBottom: 'Unterseite', viewCustom: 'Angegebene Blickrichtung', continuation: 'Fortsetzung' };
  if (lang === 'en') return { safetyTitle: 'Before assembly', safetyNotice: 'First count the parts against the full parts list and sort them by length and colour. After the complete structure is connected, fasten from bottom to top. Use panel screws at panel positions. Follow the official safety instructions before use.', safetySource: 'Official safety instructions', detailTitle: 'Local assembly actions', detailReference: 'Material references: quantities are included in the main step.', locationView: 'Location in model', viewFront: 'Front', viewBack: 'Back', viewBottom: 'Underside', viewCustom: 'Specified view direction', continuation: 'Continued' };
  return { safetyTitle: '搭建前须知', safetyNotice: '先按总表清点零件，按长度与颜色分组。完整拼好后，从下往上固定；板位使用板螺丝。使用前请核对官方安全指南。', safetySource: '官方安全指南', detailTitle: '局部动作详图', detailReference: '材料编号参考；数量已计入本步。', locationView: '成品定位', viewFront: '正面', viewBack: '背面', viewBottom: '底部', viewCustom: '指定视角', continuation: '续页' };
}

/** The physical verification status remains present when caller copy omits it. */
export function manualSafetyDescriptor(copy = {}, lang = getLang()) {
  const defaults = manualSafetyCopy(lang), text = { ...defaults, ...copy };
  const physicalNotice = lang === 'de'
    ? 'Der Aufbau vor Ort, die Prüfung der Anleitung durch erstmalige Aufbauende und die Tragfähigkeit sind noch nicht verifiziert.'
    : lang === 'en'
      ? 'On-site assembly, a walkthrough by a first-time builder, and load-bearing capacity have not yet been verified.'
      : '本说明书的现场搭建、首次搭建者走查及承载尚未验证。';
  return { type: 'safety', title: text.safetyTitle, lines: [text.safetyNotice, physicalNotice, text.safetySource, 'https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf'] };
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

export function manualDetailPageGroups(ctx, groups, copy, availableHeight = 173) {
  const pages = [];
  let page = [];
  for (const group of groups) {
    ctx.font = font(600, mm(MANUAL_TEXT_MM));
    const titleLines = wrapManualText(ctx, group.title || copy.detailTitle, mm(138.5));
    ctx.font = font(400, mm(MANUAL_TEXT_MM));
    const lines = (group.instructions || []).flatMap(line => wrapManualText(ctx, line, mm(138.5)));
    const legendH = Math.max(30, measureDetailReferences(ctx, group.items, mm(104.5)).height / PX);
    const compact = titleLines.length * 4.6 + lines.length * 4.6 + 7 + legendH + 96 <= availableHeight;
    if (!compact) {
      if (page.length) { pages.push(page); page = []; }
      ctx.font = font(600, mm(MANUAL_TEXT_MM));
      const wideTitleLines = wrapManualText(ctx, group.title || copy.detailTitle, mm(245));
      ctx.font = font(400, mm(MANUAL_TEXT_MM));
      const wideLines = (group.instructions || []).flatMap(line => wrapManualText(ctx, line, mm(245)));
      const height = 9 + wideTitleLines.length * 4.6 + wideLines.length * 4.6 + 46 + measureManualLegend(ctx, group.items, mm(245)).height / PX;
      if (height > availableHeight) throw manualError('details', `局部动作说明超过单页容量: ${group.id}`);
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
  const pageLayout = manualDetailPageLayout(ctx, `${heading} · ${copy.detailTitle}`, `${copy.detailReference || ''} · ${copy.continuation || ''}`);
  return manualDetailPageGroups(ctx, groups, copy, pageLayout.availableHeight).map((groups, continuationIndex) => ({ type: 'details', index, heading, groups, continuationIndex, countsMaterials: false, pageLayout }));
}

export function manualDetailPageLayout(ctx, title, reference) {
  ctx.font = font(600, mm(4.4));
  const titleLines = wrapManualText(ctx, title, mm(PAGE_W - M * 2));
  ctx.font = font(400, mm(MANUAL_AUX_MM));
  const referenceLines = wrapManualText(ctx, reference, mm(PAGE_W - M * 2));
  const referenceY = 5 + titleLines.length * 5.4 + 1.2;
  const bodyY = Math.max(20, Math.ceil(referenceY + referenceLines.length * 4.2 + 3));
  return { titleLines, referenceLines, referenceY, bodyY, availableHeight: PAGE_H - 17 - bodyY };
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
  drawManualArrows(ctx, left.img, mm(box.x0), mm(imgY), mm(box.imgW), mm(imgH), left.arrows, left.marks, true, left.operationMarks, left.connectorCalloutRects);
  drawManualArrows(ctx, right.img, mm(box.x1), mm(imgY), mm(box.imgW), mm(imgH), [], right.marks, true, right.operationMarks, right.connectorCalloutRects);
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
  drawManualArrows(ctx, left.img, mm(x), mm(imgY), mm(width), mm(imgH), left.arrows, left.marks, true, left.operationMarks, left.connectorCalloutRects);
  paintCaption(ctx, `${copy.actionView} · ${directionLabel(group, copy)}`, mm(x), mm(imgY), mm(imgH));
  const completeY = imgY + imgH + 2;
  drawShot(ctx, right.img, mm(x), mm(completeY), mm(width), mm(imgH), fill);
  drawMarks(ctx, right.img, mm(x), mm(completeY), mm(width), mm(imgH), right.marks, true);
  drawManualArrows(ctx, right.img, mm(x), mm(completeY), mm(width), mm(imgH), [], right.marks, true, right.operationMarks, right.connectorCalloutRects);
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
  const manualLang = getLang();
  // 在第一个异步等待之前冻结输入，编辑器切换模型或继续修改均不会进入本次导出。
  const snapshot = structuredClone(opts.modelJSON ?? opts.model.toJSON());
  const suppliedPlan = opts.plan ? structuredClone(opts.plan) : null;
  const copy = { actionView: '安装动作', completeView: '本步完成', regionOverview: '区域总览', regionShape: '独立外形', regionLocation: '成品定位', regionOrder: '拼接顺序', finalTitle: '完成造型与接口位置', instructionsTitle: '安装说明', ...manualSafetyCopy(manualLang), ...opts.copy };
  onProgress?.({ page: 0, total: 0, phase: 'resources' });
  await loadCatalog();
  const model = new BuildModel();
  const loaded = model.loadJSON(snapshot);
  if (!loaded.ok) throw manualError('model', `说明书模型无法载入: ${loaded.reason}`);
  const plan = suppliedPlan || computeAssemblyPlan(model, opts.assemblyConfig, opts.order || opts.builder?.assemblyOrder || 'y+');
  if (!plan.canExport) throw manualError('diagnostics', '模型连接诊断尚未通过，无法导出说明书', plan.diagnostics);
  const steps = plan.steps || [];
  if (!steps.length) throw manualError('empty', '模型没有可导出的装配步骤');
  const regionDescriptors = manualRegionDescriptors(model, plan);
  await document.fonts?.ready;
  const itemsCover = coverItems(plan.bom || opts.bom || computeBOM(model));
  for (const item of itemsCover) item.instanceIds = [...new Set((plan.ledger?.instances || []).filter(row => row.group === item.kind && row.key === item.ledgerKey).flatMap(row => row.partIds))];
  const icons = await loadIcons(itemsCover);
  const reading = createAssemblyReadingPlan(model, plan, { items: itemsCover, copy });
  const coverLayout = manualLegendChunks(itemsCover, true, icons, stamp, copy.bomTitle);
  const descriptors = [{ type: 'cover', items: coverLayout.chunks[0], partsH: coverLayout.partsH }, ...coverLayout.chunks.slice(1).map(items => ({ type: 'legend', title: copy.bomTitle, items }))];
  for (const entry of reading.steps) {
    const index = entry.sourceIndex;
    const heading = (copy.readingStepHeading || '{k}/{n} · {title}').replace('{k}', String(entry.index + 1)).replace('{n}', String(reading.steps.length)).replace('{title}', entry.title);
    const items = entry.materials;
    const { chunks, partsH } = manualLegendChunks(items, false, icons, stamp, `${heading} · ${copy.thisStep}`);
    const instructions = [];
    const measurement = newPageCanvas();
    const textLayout = manualStepTextLayout(measurement.ctx, heading, instructions);
    descriptors.push({ type: 'reading', index, entry, heading, items: chunks[0], allItems: items, partsH, instructions, ...textLayout });
    descriptors.push(...chunks.slice(1).map(items => ({ type: 'legend', title: `${heading} · ${copy.thisStep}`, items })));
    for (const area of entry.areas) {
      const title = `${heading} · ${(copy.readingArea || '{area}').replace('{area}', area.label)}`;
      const local = manualLegendChunks(area.materials, false, icons, stamp, `${title} · ${copy.thisStep}`);
      descriptors.push({ type: 'reading-local', index, entry, area, heading: title, items: local.chunks[0], allItems: area.materials, partsH: local.partsH, ...manualStepTextLayout(measurement.ctx, title, []) });
      descriptors.push(...local.chunks.slice(1).map(items => ({ type: 'legend', title: `${title} · ${copy.thisStep}`, items })));
    }
    measurement.c.width = measurement.c.height = 0;
  }
  descriptors.push({ type: 'final', partsH: 0 });
  const textMeasurement = newPageCanvas();
  for (let position = 0; position < descriptors.length; position++) {
    const descriptor = descriptors[position];
    if (!['region', 'overview', 'final'].includes(descriptor.type)) continue;
    const region = descriptor.region;
    const heading = region ? `${descriptor.label} · ${region.name}` : descriptor.type === 'final' ? copy.finalTitle : copy.regionOverview;
    const instructions = region ? [`${copy.regionOrder}: ${steps.filter(step => step.regionId === region.id).map(step => step.title).filter(Boolean).join(' → ')}`]
      : descriptor.type === 'overview' ? [regionDescriptors.map(row => `${row.label} · ${row.region.name}`).join('   ')]
      : [];
    const layout = manualStepTextLayout(textMeasurement.ctx, heading, instructions);
    Object.assign(descriptor, layout);
    const continuations = manualTextDescriptors(textMeasurement.ctx, `${heading} · ${copy.instructionsTitle}`, layout.remainingLines, stamp);
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
  const coverCopy = { ...copy, modelName: name || copy.product || 'design', stepsLine: String(copy.stepsLine || '').replaceAll('{n}', String(reading.steps.length)) };
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
      const image = await captureView(scene, model, yaw, { ...size, bounds: bounds || renderedBounds(scene, model), items: positionedItems(model, visibleItems, state), oneEach: true, direction, fitMargin: box.fitMargin });
      if (!local) image.marks.push(...projectStateMarks(scene, state, size.width / size.height));
      image.operationNumbers = state?.operationNumbers || [];
      image.operationMarks = projectOperationMarks(scene, model, state, size.width / size.height);
      image.connectorCalloutRects = local ? projectConnectorCalloutRects(scene, model, state, size.width / size.height) : [];
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
      const pageBox = descriptor.type === 'cover' ? coverBox(descriptor.partsH) : manualReadingPageBox(descriptor.partsH, descriptor.headerH, descriptor.type === 'reading-local');
      try {
        if (descriptor.type === 'legend') {
          paintTextPage(ctx, descriptor.title, [], stamp);
          const legendY = manualTextPageLayout(ctx, descriptor.title, [], stamp).bodyY;
          const consumed = paintLegend(ctx, descriptor.items, icons, mm(M), mm(legendY), mm(PAGE_W - M * 2) - (stamp ? stampWidth(ctx, stamp, STAMP_QR_STEP, false) + mm(STAMP_GAP) : 0), mm(PAGE_H - M));
          if (consumed !== descriptor.items.length) throw manualError('pagination', '材料续页标题与料表空间不一致');
        } else if (descriptor.type === 'instructions' || descriptor.type === 'safety') paintTextPage(ctx, descriptor.title, descriptor.lines, stamp);
        else if (descriptor.type === 'details') {
          paintTextPage(ctx, `${descriptor.heading} · ${copy.detailTitle}`, [], stamp);
          ctx.font = font(400, mm(MANUAL_AUX_MM)); ctx.fillStyle = MUTED;
          const pageLayout = descriptor.pageLayout;
          const referenceLines = wrapManualText(ctx, `${copy.detailReference}${descriptor.continuationIndex ? ` · ${copy.continuation}` : ''}`, mm(PAGE_W - M * 2));
          referenceLines.forEach((line, i) => ctx.fillText(line, mm(M), mm(pageLayout.referenceY + i * 4.2)));
          for (let groupIndex = 0; groupIndex < descriptor.groups.length; groupIndex++) {
            const group = descriptor.groups[groupIndex];
            const height = pageLayout.availableHeight;
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
            if (group.compact) paintCompactDetail(ctx, { group, left, right, location, icons, copy, x: M + groupIndex * 144.5, y: pageLayout.bodyY, height, fill: sceneFill(scene) });
            else paintDetailRow(ctx, { group, left, right, location, icons, copy, y: pageLayout.bodyY, height, fill: sceneFill(scene) });
          }
        }
        else if (descriptor.type === 'cover') {
          const front = await shot(null, 0, [], fullBounds, null, pageBox), back = await shot(null, Math.PI, [], fullBounds, null, pageBox);
          const consumed = paintCover(ctx, { front: front.img, back: back.img, copy: coverCopy, items: descriptor.items, icons, fill: sceneFill(scene), stamp, partsH: descriptor.partsH });
          if (consumed !== descriptor.items.length) throw manualError('pagination', '总料表分页与实际绘制不一致');
        } else if (descriptor.type === 'reading' || descriptor.type === 'reading-local') {
          const { entry, area } = descriptor;
          const localized = descriptor.type === 'reading-local';
          const module = entry.kind === 'module';
          const leftState = assemblyReadingState(model, plan, entry, { area: area || null, structure: !module });
          const rightState = assemblyReadingState(model, plan, entry, { area: area || null, whole: !localized });
          scene.renderModel(model, null, { assembly: rightState });
          const bounds = localized || module ? renderedBounds(scene, model) : fullBounds;
          const leftDirection = module ? readingModuleDirection(model, plan, entry) : [1, .75, 1];
          const rightDirection = localized ? [-1, .75, -1] : leftDirection;
          const priority = [...descriptor.allItems].sort((a, b) => (a.kind === 'connectors' ? 0 : 1) - (b.kind === 'connectors' ? 0 : 1) || a.num - b.num);
          scene.renderModel(model, null, { assembly: leftState });
          const leftBounds = localized ? bounds : renderedBounds(scene, model);
          const left = await shot(leftState, 0, priority.slice(0, 6), leftBounds, leftDirection, pageBox, true);
          const right = await shot(rightState, 0, priority.slice(6, 12), localized ? bounds : fullBounds, rightDirection, pageBox, true);
          const attachMarks = module ? (plan.interfaces || []).filter(marker => entry.interfaceIds.includes(marker.id) && marker.position).map((marker, i) => ({ position: marker.position, num: String.fromCharCode(65 + i) })) : [];
          const addMarks = (image, state, bounds, direction, markers) => {
            scene.renderModel(model, null, { assembly: state });
            scene._frameAlong(model, new Vector3(...direction).normalize(), { silent: true, bounds, aspect: image.img.width / image.img.height, margin: 1.18 });
            const points = scene.projectWorld(markers.map(marker => marker.position), image.img.width / image.img.height);
            image.marks.push(...points.flatMap((point, i) => point ? [{ ...point, num: markers[i].num }] : []));
          };
          if (module) {
            addMarks(left, leftState, leftBounds, leftDirection, attachMarks);
            addMarks(right, rightState, fullBounds, rightDirection, attachMarks);
          } else if (!localized && entry.areas.length) {
            const markers = entry.areas.map(value => ({ position: value.center, num: value.label }));
            addMarks(left, leftState, leftBounds, leftDirection, markers);
            addMarks(right, rightState, fullBounds, rightDirection, markers);
          }
          const consumed = paintStep(ctx, { front: left.img, back: right.img, copy: { ...copy, front: localized ? copy.readingStructureFront : module ? copy.readingModule : copy.readingLayerStructure, back: localized ? copy.readingCompleteBack : copy.readingWholeLocation, thisStep: localized ? (copy.readingAreaParts || '{area}').replace('{area}', area.label) : copy.thisStep, contextHint: '' }, heading: descriptor.heading, items: descriptor.items, icons, k: currentPage, n: total, fill: sceneFill(scene), frontMarks: left.marks, backMarks: right.marks, instructions: [], stamp, partsH: descriptor.partsH, headerH: descriptor.headerH, imageBox: pageBox });
          if (consumed !== descriptor.items.length) throw manualError('pagination', '阅读页材料分页与实际绘制不一致');
          if (localized) {
            // 定位图另占安全框，标题下方留白；截图和绘制使用相同纵横比。
            const locatorState = { ...rightState, visible: new Set(allIds), current: new Set(area.partIds), done: new Set([...allIds].filter(id => !area.partIds.includes(id))), transforms: new Map(), arrows: [], interfaceMarks: [] };
            const locationBox = { imgW: 35, imgH: 29, fitMargin: 1.3 };
            const location = await shot(locatorState, 0, [], fullBounds, [1, .75, 1], locationBox, true);
            const projection = projectReadingLocatorBounds(scene, fullBounds, location.img.width / location.img.height);
            if (!projection.complete) throw manualError('locator', copy.readingLocatorError);
            const { x: lx, y: ly } = pageBox.locator;
            ctx.fillStyle = PAPER; ctx.fillRect(mm(lx - 1), mm(ly - 1), mm(37), mm(37));
            drawShot(ctx, location.img, mm(lx), mm(ly), mm(35), mm(29), sceneFill(scene), true);
            ctx.font = font(500, mm(MANUAL_AUX_MM)); ctx.fillStyle = INK;
            wrapManualText(ctx, `${copy.readingLocation} · ${area.label}`, mm(35)).forEach((line, i) => ctx.fillText(line, mm(lx), mm(ly + 30 + i * 4)));
          }
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
            const regionIds = new Set(descriptor.partIds);
            state = { current: regionIds, done: new Set(), visible: regionIds, transforms: new Map() };
            completed = { current: regionIds, done: allIds, visible: allIds, transforms: new Map() };
            heading = `${descriptor.label} · ${descriptor.region.name}`;
            leftLabel = copy.regionShape; rightLabel = copy.regionLocation;
            instructions = [`${copy.regionOrder}: ${steps.filter(step => step.regionId === descriptor.region.id).map(step => step.title).filter(Boolean).join(' → ')}`];
          } else {
          const finalInterfaces = [];
            state = descriptor.type === 'final' ? { current: allIds, done: new Set(), visible: allIds, transforms: new Map(), interfaceMarks: finalInterfaces, arrows: [] } : null;
            completed = state;
            heading = descriptor.type === 'final' ? copy.finalTitle : copy.regionOverview;
            leftLabel = copy.front; rightLabel = copy.back;
            instructions = descriptor.type === 'overview' ? regionDescriptors.map(row => `${row.label} · ${row.region.name}`).join('   ') : finalInterfaces.map(marker => `I${marker.id.split('-').at(-1)}`).join(' · ');
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
              const locatedRegions = regionDescriptors.map(row => ({ row, center: centroid(row.partIds.map(id => partCenter(model, id)).filter(Boolean)) }))
                .filter(value => value.center?.length === 3 && value.center.every(Number.isFinite));
              const positions = scene.projectWorld(locatedRegions.map(value => value.center), image.img.width / image.img.height);
              image.marks.push(...positions.flatMap((point, i) => point ? [{ ...point, num: locatedRegions[i].row.label }] : []));
            }
          }
          const consumed = paintStep(ctx, { front: left.img, back: right.img, copy: { ...copy, ...(descriptor.type === 'final' ? { thisStep: '', none: '' } : {}), front: leftLabel, back: rightLabel, contextHint: layer ? copy.layerHint : bodyContext ? copy.bodyHint : modulePreassembly ? copy.preassemblyHint : roofCoverDetail ? copy.roofCoverHint : ['step', 'detail'].includes(descriptor.type) ? copy.contextHint : '' }, heading, items: descriptor.items || [], icons, k: currentPage, n: total, fill: sceneFill(scene), frontMarks: left.marks, backMarks: right.marks, instructions, stamp, partsH: descriptor.partsH, headerH: descriptor.headerH, instructionLines: descriptor.instructionLines });
          if (consumed !== (descriptor.items?.length || 0)) throw manualError('pagination', '步骤料表分页与实际绘制不一致');
          const box = pageBox;
          if (descriptor.type !== 'detail') drawManualArrows(ctx, left.img, mm(box.x0), mm(box.imgY), mm(box.imgW), mm(box.imgH), left.arrows, left.marks);
        }
        ctx.fillStyle = MUTED; ctx.font = font(400, mm(2)); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${currentPage} / ${total}`, mm(PAGE_W / 2), mm(PAGE_H - 2.5));
        await pageToPdf(doc, c, currentPage === 1);
        if (descriptor.type === 'safety') {
          const sourceLayout = manualTextPageLayout(ctx, descriptor.title, descriptor.lines, stamp);
          sourceLayout.lines.forEach((line, index) => {
            if (line === copy.safetySource || line.startsWith('https://quadroworld.com/')) doc.link(M, sourceLayout.bodyY + index * 5, ctx.measureText(line).width / mm(1), 5, { url: 'https://quadroworld.com/files/manuals/Sicherheitsanweisung.pdf' });
          });
        }
      } finally { c.width = c.height = 0; }
    }
    if (doc.getNumberOfPages() !== total) throw manualError('pagination', '说明书页数与导出进度不一致');
    const blob = doc.output('blob');
    await onDocument?.({ doc, blob, pages: total, plan });
    if (save) doc.save(filename || `${name || 'design'}.pdf`);
    onProgress?.({ page: total, total, phase: 'complete' });
    return { pages: total, coverRows: itemsCover.length, steps: reading.steps.length, diagnostics: plan.diagnostics, readingPlan: reading, missingPictures: itemsCover.filter(item => !partImageSrc(item.id)).map(item => item.id), blob };
  } catch (error) {
    error.page = currentPage; error.total = total;
    throw error;
  } finally {
    if (scene) { scene.onMeshesReady = () => {}; scene.dispose(); scene.renderer.forceContextLoss(); }
    host.remove();
  }
}
