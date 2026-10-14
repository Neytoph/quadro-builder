import { componentFrame } from './accessoryPack.js';

// 朝向当前视角的一面优先；只有另一面通过实际安装检查时才自动避让。
export function panelInstallationFacing(model, part, camera) {
  if (part.kind || !part.mounts?.length) return { part, conflict: null };
  const frame = componentFrame(model, part);
  if (!frame || Math.abs(frame.axes[2][1]) > .999) return { part, conflict: null };
  const towardCamera = frame.axes[2].reduce((sum, v, i) => sum + v * (camera[i] - frame.pos[i]), 0);
  if (Math.abs(towardCamera) < .001) return { part, conflict: null };
  const opposite = model.panelAccessoryDiagnostics({ ...part, side: -(part.side || 1) });
  const preferred = towardCamera > 0 ? part : opposite;
  const alternative = towardCamera > 0 ? opposite : part;
  if (preferred.valid || !alternative.valid) return { part: preferred, conflict: null };
  return { part: alternative, conflict: preferred };
}
