import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Mesh, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createAmbientRails } from '../src/player/ambient';
import { createManualFieldWindow } from '../src/player/manualFieldWindow';
import { makeSamaritanPanesOpaque } from '../src/player/samaritanOpacity';
import { budget, extendRecordedRoute } from '../src/player/extendRecordedRoute';
import { createSceneRig } from '../src/player/sceneRig';

afterEach(() => vi.unstubAllGlobals());
it('replaces continuation slabs without losing focus protection or resource restoration', async () => {
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
  const bytes = readFileSync('public/assets/samaritan/scene.glb');
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const original = JSON.parse(readFileSync('public/assets/samaritan/manifest.json', 'utf8'));
  const manifest = extendRecordedRoute(gltf.scene, gltf.animations, original, { continuationCopies: false });
  expect(manifest.anchors).toHaveLength(10);
  expect(budget.continuationNodes).toBe(0);
  expect(gltf.scene.getObjectByName('extension_field_1')).toBeUndefined();
  expect(gltf.animations.flatMap(c => c.tracks).some(t => t.name.startsWith('extension_field_'))).toBe(false);
  const originals = new Map<Mesh, Material | Material[]>();
  const blockers = new Map<Mesh, Material | Material[]>();
  gltf.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    originals.set(node, node.material);
    if (/^extension_blocker_m\d+$/.test(node.name)) blockers.set(node, node.material);
  });
  expect(blockers.size).toBeGreaterThan(0);
  const restore = makeSamaritanPanesOpaque(gltf.scene);
  for (const [mesh, source] of blockers) expect(mesh.material).toBe(source);
  const focusNames = manifest.anchors!.map(a => a.screen);
  const protectedNames = manifest.anchors!.flatMap(a => [a.screen, a.anchorNode]);
  const ambient = createAmbientRails(gltf.scene, gltf.animations, protectedNames);
  const rig = createSceneRig(gltf.scene, gltf.animations, manifest);
  rig.seek(0);
  const originalFar = rig.camera.far;
  const field = createManualFieldWindow(gltf.scene, {
    camera: rig.camera, clips: gltf.animations, focusNames,
    protectedNames: [...protectedNames, ...ambient.selection.map(a => a.name)], centreThinning: .9,
  });
  expect(field.slotCount).toBeGreaterThan(0);
  expect(field.slotCount).toBeLessThanOrEqual(9000);
  expect(field.batchCount).toBeGreaterThan(0);
  const slots = field.slotCount, batches = field.batchCount;
  for (const anchor of [...manifest.anchors!, ...manifest.anchors!.slice().reverse()]) {
    rig.seek(anchor.holdStart); field.update();
    expect(field.slotCount).toBe(slots); expect(field.batchCount).toBe(batches);
    for (const name of [...protectedNames, ...ambient.selection.map(a => a.name)]) expect(gltf.scene.getObjectByName(name)).toBeDefined();
    const pane = gltf.scene.getObjectByName(anchor.screen) as Mesh;
    expect(pane.material).toMatchObject({ opacity: 1, transparent: false, depthWrite: true });
  }
  field.dispose(); field.dispose();
  expect(rig.camera.far).toBe(originalFar);
  expect(gltf.scene.getObjectByName('manual_field_window')).toBeUndefined();
  ambient.dispose(); restore(); restore();
  for (const [mesh, source] of originals) expect(mesh.material).toBe(source);
  rig.dispose();
});
