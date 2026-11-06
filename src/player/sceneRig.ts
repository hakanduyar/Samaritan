import {
  AnimationMixer,
  LoopOnce,
  PropertyBinding,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/** Allowed difference between manifest durationSeconds and the GLB clip. */
export const DURATION_TOLERANCE_SECONDS = 1e-3;

export interface RigContract {
  cameraName: string;
  clipName: string;
  durationSeconds: number;
  focalScreenName: string;
}

export interface SceneRig {
  camera: PerspectiveCamera;
  clip: AnimationClip;
  focalScreen: Object3D;
  duration: number;
  /** Evaluates the authored clip at exactly `seconds` (clamped to the clip). */
  seek(seconds: number): number;
  dispose(): void;
}

export class RigContractError extends Error {
  override name = "RigContractError";
}

function findByName(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name) ?? root.getObjectByName(PropertyBinding.sanitizeNodeName(name));
}

function isPerspectiveCamera(object: Object3D): object is PerspectiveCamera {
  return (object as PerspectiveCamera).isPerspectiveCamera === true;
}

function resolveCamera(root: Object3D, name: string): PerspectiveCamera {
  const node = findByName(root, name);
  if (!node) throw new RigContractError(`camera "${name}" not found in scene`);
  if (isPerspectiveCamera(node)) return node;
  const found: PerspectiveCamera[] = [];
  node.traverse((child) => {
    if (isPerspectiveCamera(child)) found.push(child);
  });
  if (found.length !== 1 || !found[0]) {
    throw new RigContractError(
      `node "${name}" must be or contain exactly one perspective camera (found ${found.length})`,
    );
  }
  return found[0];
}

function isSelfOrAncestor(candidate: Object3D, of: Object3D): boolean {
  for (let node: Object3D | null = of; node; node = node.parent) {
    if (node === candidate) return true;
  }
  return false;
}

function clipAnimatesCamera(root: Object3D, clip: AnimationClip, camera: PerspectiveCamera): boolean {
  return clip.tracks.some((track) => {
    const { nodeName } = PropertyBinding.parseTrackName(track.name);
    if (!nodeName) return false;
    const target = PropertyBinding.findNode(root, nodeName) as Object3D | null;
    return target !== null && isSelfOrAncestor(target, camera);
  });
}

/**
 * Binds the imported scene's own named camera and named clip. The camera is
 * the GLB's camera object; nothing here creates or moves a camera by itself.
 */
export function createSceneRig(
  root: Object3D,
  animations: readonly AnimationClip[],
  contract: RigContract,
): SceneRig {
  const camera = resolveCamera(root, contract.cameraName);

  const clip = animations.find((candidate) => candidate.name === contract.clipName);
  if (!clip) {
    const names = animations.map((candidate) => JSON.stringify(candidate.name)).join(", ");
    throw new RigContractError(
      `animation "${contract.clipName}" not found (available: ${names || "none"})`,
    );
  }
  if (Math.abs(clip.duration - contract.durationSeconds) > DURATION_TOLERANCE_SECONDS) {
    throw new RigContractError(
      `clip duration ${clip.duration}s does not match manifest durationSeconds ${contract.durationSeconds}s`,
    );
  }
  if (!clipAnimatesCamera(root, clip, camera)) {
    throw new RigContractError(`animation "${clip.name}" has no track driving the camera`);
  }

  const focalScreen = findByName(root, contract.focalScreenName);
  if (!focalScreen) {
    throw new RigContractError(`focal screen "${contract.focalScreenName}" not found in scene`);
  }

  const mixer = new AnimationMixer(root);
  const action: AnimationAction = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  // A paused action with a zero-delta mixer update evaluates exactly at
  // `action.time`, independent of any previous seek (no accumulated drift).
  action.paused = true;

  const duration = clip.duration;
  let disposed = false;

  return {
    camera,
    clip,
    focalScreen,
    duration,
    seek(seconds) {
      if (disposed) return 0;
      const time = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), duration) : 0;
      action.enabled = true;
      action.paused = true;
      action.time = time;
      mixer.update(0);
      root.updateMatrixWorld(true);
      return time;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheClip(clip);
      mixer.uncacheRoot(root);
    },
  };
}
