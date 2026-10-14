import { getPartById, getTube, partForFitting, partName, textilePart } from './catalog.js';
import { t } from './i18n.js';

export function installationReason(model, diagnostic) {
  if (!diagnostic.reason) return null;
  const obstacle = diagnostic.obstacle;
  const part = obstacle && (model.panels.get(obstacle.id) || model.textiles.get(obstacle.id) || model.fittings.get(obstacle.id) || model.tubes.get(obstacle.id) || model.slides.get(obstacle.id));
  if (!part) return t('accessory_reason_' + diagnostic.reason);
  let spec;
  if (part.panelId) spec = getPartById(part.panelId);
  else if (model.tubes.has(part.id)) spec = getTube(part.tubeId);
  else if (part.kind) spec = partForFitting(part.kind, part.mask);
  else spec = textilePart(part, part.variant);
  const name = partName(spec) || t('accessory_obstacle_' + obstacle.kind);
  if (diagnostic.reason === 'mount_occupied') {
    const tube = model.tubes.get(obstacle.tube), rail = tube && model._rail(tube.id);
    if (rail && Number.isFinite(obstacle.t)) {
      const tubeSpec = getTube(tube.tubeId), length = tube.length ?? tubeSpec?.length_cm;
      const inset = Number.isFinite(length) && length > 0 ? Math.max(0, (rail.len - length) / 2) : 0;
      const distance = Math.round(Math.max(0, Math.min(obstacle.t, 1 - obstacle.t) * rail.len - inset) * 10) / 10;
      return t('accessory_mount_conflict_detail', name, partName(tubeSpec) || t('accessory_obstacle_tube'), distance);
    }
  }
  if (diagnostic.reason === 'opening_occupied') return t('accessory_opening_conflict_detail', name);
  if (diagnostic.reason === 'component_space') return t('accessory_space_conflict_detail', name);
  if (diagnostic.reason === 'swing_clearance') return t('accessory_swing_conflict_detail', name);
  return t('accessory_reason_' + diagnostic.reason);
}
