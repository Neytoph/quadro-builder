import { describe, expect, it } from 'vitest';
import { assemblyProfilePosition, assemblyProfileFallbackVisible } from './assemblyProfilePresentation.js';
import * as THREE from 'three';
import { SceneManager } from './scene.js';

const run = { tubes: ['lower', 'upper'], from: [10, 20, 30] as [number, number, number] };
describe('reinforcement illustration pose', () => {
  it('hides an uninserted profile in the prepare action', () => {
    expect(assemblyProfilePosition({ profileVisible: new Set(), visible: new Set(run.tubes) }, run)).toBeNull();
    expect(assemblyProfileFallbackVisible({ profileVisible: new Set() }, false)).toBe(false);
    expect(assemblyProfileFallbackVisible({ profileVisible: new Set(['lower']) }, false)).toBe(false);
    expect(assemblyProfileFallbackVisible(undefined, false)).toBe(true);
    expect(assemblyProfileFallbackVisible(undefined, true)).toBe(false);
  });
  it('uses the explicit loose profile pose while its carrier stays still', () => {
    const state = { profileVisible: new Set(['lower']), profileTransforms: new Map([['lower', [0, 80, 0]]]), transforms: new Map([['lower', [0, 12, 0]]]) };
    expect(assemblyProfilePosition(state, run)).toEqual([10, 100, 30]);
    state.profileTransforms.set('lower', [0, 0, 0]);
    expect(assemblyProfilePosition(state, run)).toEqual([10, 20, 30]);
  });
  it('keeps older detached-frame overviews aligned to the first visible carrier', () => {
    expect(assemblyProfilePosition({ visible: new Set(['upper']), transforms: new Map([['upper', [0, 45, 0]]]) }, run)).toEqual([10, 65, 30]);
    expect(assemblyProfilePosition(undefined, run)).toEqual(run.from);
  });

  it('applies actual batched Scene transforms once while retaining profile picking on its carrier', () => {
    const scene: any = { _batches: new Map(), buildGroup: new THREE.Group(), _indexParts: SceneManager.prototype._indexParts, _bindPieces: SceneManager.prototype._bindPieces };
    const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshBasicMaterial(), pick: any[] = [];
    const state = { visible: new Set(run.tubes), transforms: new Map([['lower', [0, 12, 0]]]), profileVisible: new Set(['lower']), profileTransforms: new Map([['lower', [0, 80, 0]]]) };
    const batchAdd = SceneManager.prototype._batchAdd as (...args: any[]) => void;
    const profilePosition = assemblyProfilePosition(state, run)!;
    batchAdd.call(scene, geo, mat, new THREE.Matrix4().makeTranslation(...run.from), 'tube', 'lower', pick);
    batchAdd.call(scene, geo, mat, new THREE.Matrix4().makeTranslation(profilePosition[0], profilePosition[1], profilePosition[2]), 'tube', 'lower', pick, { tubes: run.tubes, assemblyPoseApplied: true });
    SceneManager.prototype._batchFlush.call(scene);
    SceneManager.prototype._applyAssemblyTransforms.call(scene, state.transforms);
    const mesh = scene.buildGroup.children[0] as THREE.InstancedMesh, matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix); expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([10, 32, 30]);
    mesh.getMatrixAt(1, matrix); expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([10, 100, 30]);
    expect(mesh.userData.instances[1]).toMatchObject({ kind: 'tube', id: 'lower', tubes: run.tubes });
    expect(pick).toContain(mesh);
    geo.dispose(); mat.dispose(); mesh.dispose();
  });
});
