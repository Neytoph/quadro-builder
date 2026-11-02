import * as THREE from 'three';

export const RAINBOW_RIBBON_COLORS = [0xd83a2e, 0xf07f1a, 0xf2c12e, 0x2f9e44, 0x2b6fd6, 0x6a3fb5, 0xc23f8e];
export const RAINBOW_RIBBON_WIDTH_CM = 4;
export const RAINBOW_CONNECTOR_CLEARANCE_CM = 0.15;

export function rainbowRibbonLayout(along, connectorSize = 5) {
  if (!Number.isFinite(along) || along <= 0) throw new RangeError('Invalid rainbow textile width');
  const inset = Math.min(connectorSize / 2 + RAINBOW_CONNECTOR_CLEARANCE_CM, along * 0.4);
  const usable = along - 2 * inset;
  // 单根宽度固定，QDF毫米级取整误差不改变彩带数量。
  const width = RAINBOW_RIBBON_WIDTH_CM;
  const preferredGap = 1.2, minimumGap = 0.4;
  const count = Math.max(0, Math.min(Math.floor((usable + minimumGap) / (width + minimumGap)), Math.round((usable + preferredGap) / (width + preferredGap))));
  const gap = count > 1 ? (usable - count * width) / (count - 1) : 0;
  const start = count > 1 ? inset : (along - width) / 2;
  return Array.from({ length: count }, (_, i) => ({
    center: start + width / 2 + i * (width + gap),
    width,
    color: RAINBOW_RIBBON_COLORS[i % RAINBOW_RIBBON_COLORS.length],
  }));
}

export function createRainbowRibbonSheet(width, span, radius) {
  const geo = new THREE.PlaneGeometry(width, Math.max(0.01, span - 2 * radius));
  geo.rotateX(-Math.PI / 2);
  // 布带位于两根管轴构成的平面，端头接套环朝向开口的一侧。
  geo.translate(0, 0, span / 2);
  return geo;
}

export function createRainbowRibbonSleeve(width, radius) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 32, 1, true);
  geo.rotateZ(Math.PI / 2);
  return geo;
}
