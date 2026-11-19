import { Mesh, type Object3D, type Material } from "three";

/** Photos occlude their surroundings; distance fades use coverage, not see-through glass. */
export function makeSamaritanPanesOpaque(root: Object3D) {
  const owned = new Map<Material, Material>();
  const swaps: Array<[Mesh, Material]> = [];
  root.traverse((node) => {
    // Route-extension blockers own animated opacity tracks and must keep fading smoothly.
    if (!(node instanceof Mesh) || Array.isArray(node.material) || /^extension_blocker_m\d+$/.test(node.name)
      || !/^mat_(field_cell|focus_tile_cell|landmark_cell|focal_screen|optic_shutter_cell)/.test(node.material.name)) return;
    const source = node.material;
    let material = owned.get(source);
    if (!material) {
      const cloned: Material = source.clone();
      material = cloned;
      cloned.onBeforeCompile = source.onBeforeCompile;
      cloned.customProgramCacheKey = source.customProgramCacheKey;
      cloned.opacity = 1;
      cloned.transparent = false;
      cloned.depthWrite = true;
      cloned.alphaHash = false;
      cloned.alphaTest = 0.2;
      cloned.forceSinglePass = true;
      owned.set(source, cloned);
    }
    node.material = material;
    swaps.push([node, source]);
  });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [mesh, source] of swaps) mesh.material = source;
    for (const material of owned.values()) material.dispose();
  };
}

