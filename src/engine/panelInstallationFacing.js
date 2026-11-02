import { componentFrame } from './accessoryPack.js';
import { confirmedSpec } from './componentPack.js';

// 朝向当前视角的一面优先；只有另一面通过实际安装检查时才自动避让。
export function panelInstallationFacing(model, part, camera, oppositeCandidate = null) {
  const sector=confirmedSpec(part.kind || part.partId)?.feature==='sector';
  if ((part.kind && !sector) || !part.mounts?.length) return { part, conflict: null };
  const frame = componentFrame(model, part);
  if (!frame) return { part, conflict: null };
  const towardCamera = frame.axes[2].reduce((sum, v, i) => sum + v * (camera[i] - frame.pos[i]), 0);
  if (Math.abs(towardCamera) < .001) return { part, conflict: null };
  let opposite;
  if (sector) opposite = oppositeCandidate || model.confirmedDiagnostics({ ...part, facing: -(part.facing || 1) });
  else if (part.nativeGeometry) opposite = model.panelPlacementDiagnostics({ ...part, side: -(part.side || 1) });
  else opposite = model.panelAccessoryDiagnostics({ ...part, side: -(part.side || 1) });
  const preferred = towardCamera > 0 ? part : opposite;
  const alternative = towardCamera > 0 ? opposite : part;
  if (preferred.valid || !alternative.valid) return { part: preferred, conflict: null };
  return { part: alternative, conflict: preferred };
}
