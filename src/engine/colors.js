// 与 vokako/quadro-3d-designer 对齐的选色：经典四色、Home 柔和色、一键换色家族。

export const CLASSIC_COLOR_IDS = ["red", "green", "blue", "yellow"];
export const HOME_COLOR_IDS = ["petrol", "mint", "berry"];

export const COLOR_HEX = {
  red: "#e53e3e",
  green: "#38a169",
  blue: "#3182ce",
  yellow: "#ecc94b",
  petrol: "#2f6f7e",
  mint: "#9ed3bf",
  berry: "#b5678f",
  apricot: "#e6a875",
};

export const PALETTES = [
  { key: "classic", colors: ["#e53e3e", "#ecc94b", "#38a169", "#3182ce"] },
  { key: "home-blue", colors: ["#e9e4d6", "#a9c5dc", "#6e93b4", "#2e3a4c", "#8b95a0"] },
  { key: "home-green", colors: ["#e9e4d6", "#a7be9a", "#6e8f6a", "#364a3c", "#8b95a0"] },
  { key: "home-pink", colors: ["#e9e4d6", "#d9afc0", "#a96d86", "#4a3542", "#8b95a0"] },
];

const HOME_TO_OFFICIAL = {
  petrol: "blue",
  mint: "green",
  berry: "red",
  apricot: "yellow",
};

const OFFICIAL_IDS = ["red", "green", "blue", "yellow", "black"];

export function isHexColor(id) {
  return typeof id === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(id);
}

export function parseRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length === 3) {
    return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  }
  if (h.length < 6) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** QDF 只认官方四色（外加黑）。Home / 调色板 hex 就近落到这几个。 */
export function officialColorId(colorId) {
  if (OFFICIAL_IDS.includes(colorId)) return colorId;
  if (HOME_TO_OFFICIAL[colorId]) return HOME_TO_OFFICIAL[colorId];
  const rgb = parseRgb(isHexColor(colorId) ? colorId : (COLOR_HEX[colorId] || ""));
  if (!rgb) return "blue";
  let best = "blue", bestD = Infinity;
  for (const id of CLASSIC_COLOR_IDS) {
    const o = parseRgb(COLOR_HEX[id]);
    if (!o) continue;
    const d = (rgb[0] - o[0]) ** 2 + (rgb[1] - o[1]) ** 2 + (rgb[2] - o[2]) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
