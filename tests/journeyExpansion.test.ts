import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expandJourney } from '../src/player/journeyExpansion';
import { extendRecordedRoute } from '../src/player/extendRecordedRoute';
import { createSceneRig } from '../src/player/sceneRig';
import { resolveCatalog } from '../src/player/recordedCatalog';

afterEach(() => vi.unstubAllGlobals());
it('lengthens travel while preserving focus composition, hold timing and all ten media bindings', async () => {
 vi.stubGlobal('self', globalThis);
 vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
 const bytes = readFileSync('public/assets/samaritan/scene.glb');
 const load = () => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
 const [baseline, candidate] = await Promise.all([load(), load()]);
 const manifest = JSON.parse(readFileSync('public/assets/samaritan/manifest.json', 'utf8'));
 const original = createSceneRig(baseline.scene, baseline.animations, manifest);
 const offsets = manifest.anchors.map((anchor: { screen: string; holdStart: number }) => {
  original.seek(anchor.holdStart);
  return baseline.scene.getObjectByName(anchor.screen)!.getWorldPosition(new Vector3()).sub(original.camera.getWorldPosition(new Vector3()));
 });
 expandJourney(candidate.scene, candidate.animations, manifest);
 const expanded = createSceneRig(candidate.scene, candidate.animations, manifest);
 expanded.seek(0); const start = expanded.camera.getWorldPosition(new Vector3());
 expanded.seek(manifest.anchors[0].holdStart);
 expect(Math.abs(expanded.camera.getWorldPosition(new Vector3()).z-start.z)).toBeCloseTo(6.75, 3);
 for (let i=0; i<manifest.anchors.length; i++) {
  const anchor=manifest.anchors[i]; expanded.seek(anchor.holdStart);
  const relative=candidate.scene.getObjectByName(anchor.screen)!.getWorldPosition(new Vector3()).sub(expanded.camera.getWorldPosition(new Vector3()));
  expect(relative.distanceTo(offsets[i]!)).toBeLessThan(.02);
 }
 expanded.seek(manifest.anchors[0].holdEnd); const from=expanded.camera.getWorldPosition(new Vector3());
 expanded.seek(manifest.anchors[1].holdStart); const to=expanded.camera.getWorldPosition(new Vector3());
 expect(Math.abs(to.z-from.z)).toBeLessThan(.02);
 expect(Math.abs(to.x-from.x)).toBeGreaterThan(2);
 expanded.dispose();
 const extended=extendRecordedRoute(candidate.scene,candidate.animations,manifest,{continuationCopies:false});
 expect(extended.anchors).toHaveLength(10);
 expect(extended.anchors!.slice(0,6)).toEqual(manifest.anchors);
 expect(resolveCatalog(extended.anchors!).map(entry=>entry.id)).toEqual(['s00','aircargo','s01','s02','s03','harbor','s04','s05','s06']);
 original.dispose();
});
