/** Reinforcement meshes are explanatory drawings placed beside their carrier.
 * The assembly state supplies the actual operation pose; older overview states
 * follow the first visible carrier so detached frames retain their alignment.
 */
export function assemblyProfilePosition(assembly, run) {
  const first = run.tubes[0];
  if (assembly?.profileVisible && !assembly.profileVisible.has(first)) return null;
  const carrier = run.tubes.find(id => !assembly || assembly.visible?.has(id) || assembly.current?.has(id) || assembly.done?.has(id));
  const offset = assembly?.profileTransforms?.get(first) || assembly?.transforms?.get(carrier) || [0, 0, 0];
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) throw new Error(`Invalid profile transform: ${first}`);
  return run.from.map((value, axis) => value + offset[axis]);
}
