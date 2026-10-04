/** 区域配置只存用户决定；失效零件引用由装配计划诊断。 */
export function validAssemblyConfig(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.regions) || !Array.isArray(config.order)) return false;
  const ids = new Set();
  for (const region of config.regions) {
    if (!region || typeof region.id !== 'string' || !region.id || ids.has(region.id) ||
      typeof region.name !== 'string' || !Array.isArray(region.partIds) ||
      region.partIds.some(id => typeof id !== 'string' || !id) || new Set(region.partIds).size !== region.partIds.length) return false;
    ids.add(region.id);
  }
  return config.order.length === ids.size && new Set(config.order).size === ids.size && config.order.every(id => ids.has(id));
}
