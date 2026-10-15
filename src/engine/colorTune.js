// 场景 / 架子配色与滤镜。调色台 UI 先藏着，默认值即当前定稿。

import { COLOR_HEX } from "./colors.js";
import { tubeColors } from "./catalog.js";

export const TUNE_KEY = "quadro.colorTune.v3";

/** iPhone 照片式滤镜，0 为原样。滑杆约 -100…100。 */
export const DEFAULT_GRADE = {
  exposure: 0,
  brilliance: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  brightness: 0,
  blackPoint: 16,
  saturation: 0,
  vibrance: 40,
  warmth: 0,
  tint: 7,
  fade: 0,
};

export const DEFAULT_TUNE = {
  scene: {
    blank: "#EDD8C4",
    skyHorizon: "#EAF5FD",
    skyZenith: "#A7D9FB",
    grass: "#7A9B6C",
    trunk: "#6B5A3E",
    crownA: "#649655",
    crownB: "#709B62",
    crownC: "#56804A",
    bush: "#4A7544",
    hemiGround: "#6A8258",
    dirIntensity: 1.42,
    hemiIntensity: 1.22,
  },
  frame: {
    red: "#F23B3B",
    green: "#2FCB5A",
    blue: "#2B8FF0",
    yellow: "#FFD942",
    petrol: "#3A8494",
    mint: "#7ECBB0",
    berry: "#C46B90",
    apricot: "#E8AE7A",
  },
  grade: { ...DEFAULT_GRADE },
};

export function shadeHex(hex, amt) {
  const n = parseHexNum(hex);
  if (n == null) return "#808080";
  const r = clampByte(((n >> 16) & 255) + amt);
  const g = clampByte(((n >> 8) & 255) + amt);
  const b = clampByte((n & 255) + amt);
  return rgbHex(r, g, b);
}

export function hexRgba(hex, a) {
  const n = parseHexNum(hex);
  if (n == null) return `rgba(0,0,0,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function normHex(hex) {
  const s = String(hex || "").trim();
  if (/^#([0-9a-fA-F]{6})$/.test(s)) return "#" + s.slice(1).toUpperCase();
  if (/^#([0-9a-fA-F]{3})$/.test(s)) {
    const h = s.slice(1);
    return ("#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toUpperCase();
  }
  if (/^([0-9a-fA-F]{6})$/.test(s)) return ("#" + s).toUpperCase();
  return null;
}

export function mergeTune(base, extra) {
  const scene = { ...(base?.scene || DEFAULT_TUNE.scene) };
  const frame = { ...(base?.frame || DEFAULT_TUNE.frame) };
  const grade = { ...(base?.grade || DEFAULT_GRADE) };
  const inScene = extra && extra.scene && typeof extra.scene === "object" ? extra.scene : {};
  const inFrame = extra && extra.frame && typeof extra.frame === "object" ? extra.frame : {};
  const inGrade = extra && extra.grade && typeof extra.grade === "object" ? extra.grade : {};
  for (const [k, v] of Object.entries(inScene)) {
    if (k === "dirIntensity" || k === "hemiIntensity") {
      const n = Number(v);
      if (Number.isFinite(n)) scene[k] = n;
      continue;
    }
    const hex = normHex(v);
    if (hex) scene[k] = hex;
  }
  for (const [k, v] of Object.entries(inFrame)) {
    const hex = normHex(v);
    if (hex) frame[k] = hex;
  }
  for (const [k, v] of Object.entries(inGrade)) {
    if (!(k in DEFAULT_GRADE)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) grade[k] = Math.max(-100, Math.min(100, n));
  }
  return { scene, frame, grade };
}

/** 解析调色 JSON。整份（含 scene+frame）按出厂底合并；片段则叠在 current 上。 */
export function parseTuneJson(text) {
  try {
    const raw = JSON.parse(String(text || "").trim());
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function applyTuneJson(current, text) {
  const raw = parseTuneJson(text);
  if (!raw) return null;
  const base = raw.scene && raw.frame ? DEFAULT_TUNE : (current || DEFAULT_TUNE);
  return mergeTune(base, raw);
}

export function loadTune() {
  try {
    const raw = localStorage.getItem(TUNE_KEY);
    if (!raw) return structuredClone(DEFAULT_TUNE);
    return mergeTune(DEFAULT_TUNE, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_TUNE);
  }
}

export function saveTune(tune) {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(mergeTune(DEFAULT_TUNE, tune)));
  } catch { /* ignore */ }
}

/** 改目录和 COLOR_HEX，让 colorHex() / 色块立刻读到新值。不写 parts.json。 */
export function applyFrameHex(frame) {
  if (!frame) return;
  for (const [id, raw] of Object.entries(frame)) {
    const hex = normHex(raw);
    if (!hex) continue;
    COLOR_HEX[id] = hex;
    try {
      const c = tubeColors().find((x) => x.id === id);
      if (c) c.hex = hex;
    } catch { /* catalog not ready */ }
  }
}

/** 调色台当前滤镜后的色。产品色本身仍是 frame 里的底色。 */
export function gradeHex(hex, grade) {
  const n = parseHexNum(hex);
  if (n == null) return hex;
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const out = applyGrade(r, g, b, grade);
  return rgbHex(out[0] * 255, out[1] * 255, out[2] * 255);
}

export function displayHex(colorId, grade) {
  return gradeHex(lookupHex(colorId), grade);
}

function lookupHex(colorId) {
  if (isHexLike(colorId)) return normHex(colorId) || "#888888";
  if (COLOR_HEX[colorId]) return COLOR_HEX[colorId];
  try {
    const c = tubeColors().find((x) => x.id === colorId);
    if (c?.hex) return c.hex;
  } catch { /* catalog not ready */ }
  return "#888888";
}

function isHexLike(id) {
  return typeof id === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(id);
}

function applyGrade(r, g, b, grade) {
  const gr = { ...DEFAULT_GRADE, ...(grade || {}) };
  const a = (k) => (Number(gr[k]) || 0) / 100;

  const exp = Math.pow(2, a("exposure"));
  r *= exp; g *= exp; b *= exp;

  r += a("brightness") * 0.32;
  g += a("brightness") * 0.32;
  b += a("brightness") * 0.32;

  const ct = 1 + a("contrast") * 0.85;
  r = (r - 0.5) * ct + 0.5;
  g = (g - 0.5) * ct + 0.5;
  b = (b - 0.5) * ct + 0.5;

  let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const hi = smooth01((y - 0.42) / 0.58) * a("highlights") * 0.45;
  const sh = (1 - smooth01(y / 0.52)) * a("shadows") * 0.45;
  r += hi + sh; g += hi + sh; b += hi + sh;

  y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mid = 1 - Math.abs(y - 0.5) * 2;
  const br = mid * a("brilliance") * 0.28;
  r += br; g += br; b += br;

  const bp = a("blackPoint") * 0.22;
  const den = 1 - bp;
  if (Math.abs(den) > 1e-4) {
    r = (r - bp) / den;
    g = (g - bp) / den;
    b = (b - bp) / den;
  }

  r += a("warmth") * 0.14;
  b -= a("warmth") * 0.14;
  g += a("tint") * 0.12;
  r -= a("tint") * 0.05;
  b -= a("tint") * 0.05;

  y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 1 + a("saturation");
  r = y + (r - y) * sat;
  g = y + (g - y) * sat;
  b = y + (b - y) * sat;

  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const vib = a("vibrance") * (1 - clamp01(chroma * 1.6));
  r = y + (r - y) * (1 + vib);
  g = y + (g - y) * (1 + vib);
  b = y + (b - y) * (1 + vib);

  const fade = Math.max(0, a("fade"));
  if (fade) {
    const lifted = 0.42 + y * 0.22;
    r = r * (1 - fade) + lifted;
    g = g * (1 - fade) + lifted;
    b = b * (1 - fade) + lifted;
  }

  return [clamp01(r), clamp01(g), clamp01(b)];
}

function parseHexNum(hex) {
  const n = normHex(hex);
  if (!n) return null;
  return parseInt(n.slice(1), 16);
}

function smooth01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbHex(r, g, b) {
  const R = clampByte(r);
  const G = clampByte(g);
  const B = clampByte(b);
  return "#" + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1).toUpperCase();
}
