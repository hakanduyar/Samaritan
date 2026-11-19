import { MathUtils, Mesh, Vector3, type Object3D } from "three";
import type { SceneManifest } from "../contract/manifest";
import type { SceneRig } from "./sceneRig";
import { hasTouchCapability } from "./touchNavigation";

/** Shorter viewport side at or below which a touch device is treated as a phone. */
const PHONE_MAX_SHORT_SIDE = 767;

/** Touch capability plus a small viewport; landscape phones qualify, wide desktops do not. */
export function isPhoneViewport(win: Parameters<typeof hasTouchCapability>[0], width: number, height: number): boolean {
  return Math.min(width, height) <= PHONE_MAX_SHORT_SIDE && hasTouchCapability(win);
}

/**
 * Measures every manifest focus pane once and returns a viewport lens that keeps the
 * largest pane inside a 4% margin while the world still fills every pixel (no scaled canvas).
 */
export function createSamaritanPhoneFraming(root: Object3D, rig: SceneRig, manifest: SceneManifest) {
  const vertex = new Vector3();
  let horizontal = 0, vertical = 0;
  for (const anchor of manifest.anchors ?? []) {
    const pane = root.getObjectByName(anchor.screen);
    if (!pane) continue;
    for (const time of [anchor.holdStart, (anchor.holdStart + anchor.holdEnd) / 2, anchor.holdEnd]) {
      rig.seek(time);
      pane.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          object.getVertexPosition(i, vertex).applyMatrix4(object.matrixWorld).applyMatrix4(rig.camera.matrixWorldInverse);
          if (vertex.z >= -rig.camera.near) continue;
          horizontal = Math.max(horizontal, Math.abs(vertex.x / vertex.z));
          vertical = Math.max(vertical, Math.abs(vertex.y / vertex.z));
        }
      });
    }
  }
  // Sampling moved the camera along the route; return it to the source pose.
  rig.seek(0);
  const sourceZoom = rig.camera.zoom;
  // The finite vignette plane shows its edges in the native phone frustum; hide it only while fitted.
  const vignette = root.getObjectByName("fx_vignette");
  const vignetteVisible = vignette?.visible ?? true;
  const halfHeight = Math.tan(MathUtils.degToRad(rig.camera.fov / 2));
  return {
    fit(width: number, height: number) {
      const aspect = Math.max(1, width) / Math.max(1, height);
      if (vignette) vignette.visible = false;
      rig.camera.clearViewOffset();
      rig.camera.aspect = aspect;
      rig.camera.zoom = Math.min(sourceZoom, .92 * halfHeight / Math.max(vertical, horizontal / aspect, 1e-6));
      rig.camera.updateProjectionMatrix();
    },
    /** Back to the authored lens and source aspect (desktop, opening, resize out of phone size). */
    restore() {
      if (vignette) vignette.visible = vignetteVisible;
      rig.camera.clearViewOffset();
      rig.camera.aspect = manifest.sourceAspectRatio;
      rig.camera.zoom = sourceZoom;
      rig.camera.updateProjectionMatrix();
    },
  };
}
