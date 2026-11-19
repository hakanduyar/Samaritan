import {
  Box3, Float32BufferAttribute, Group, Mesh, NumberKeyframeTrack, Object3D, Vector3,
  type AnimationClip, type KeyframeTrack, type Material,
} from "three";
import type { SceneManifest } from "../contract/manifest";
import admission from "./holdAdmission.json";
import rests from "./holdRestAdmission.json";
import { createHoldMap, type Hold } from "./holdMapping";

type Offset = { x: number; y: number };
type LegKind = "yx" | "forward-x";
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Small self-contained leg easing: sideways in two phases, or forward first and then sideways. */
function journeyLeg(progress: number, from: Offset, to: Offset, kind: LegKind) {
  const p = Math.max(0, Math.min(1, progress));
  const first = ease(p / .5), second = ease((p - .5) / .5), afterForward = ease((p - .58) / .42);
  if (kind === "yx") return { x: from.x + (to.x - from.x) * second, y: from.y + (to.y - from.y) * first, forward: 0 };
  return { x: from.x + (to.x - from.x) * afterForward, y: from.y + (to.y - from.y) * afterForward, forward: Math.min(1, p / .58) };
}

/** Last extension build: counts for review/diagnostics only. */
export const budget = { hiddenForeground: 0, continuationNodes: 0 };
const CLIP_NAME ="samaritan_interactive_extended_v1";
const TRAVEL_SECONDS = 22;
const HOLD_SECONDS = 3.2;
const END_REST_SECONDS = 1.5;
const DISTANCE_SCALE = 1.35;
// These atlas tiles are absent from the six original focus stops.
const FEEDS = [
  { screen: "extension_screen_07", anchorNode: "extension_anchor_07", tile: 3 },
  { screen: "extension_screen_08", anchorNode: "extension_anchor_08", tile: 12 },
  { screen: "extension_screen_09", anchorNode: "extension_anchor_09", tile: 7 },
  { screen: "extension_screen_10", anchorNode: "extension_anchor_10", tile: 9 },
] as const;
const addedAnchors = FEEDS.map((feed, index) => {
  const holdStart = admission.durationSeconds + (index + 1) * TRAVEL_SECONDS + index * HOLD_SECONDS;
  return { screen: feed.screen, anchorNode: feed.anchorNode, holdStart, holdEnd: holdStart + HOLD_SECONDS };
});
export const extendedSamaritanAdmission = {
  ...admission,
  clipName: CLIP_NAME,
  durationSeconds: addedAnchors[addedAnchors.length - 1]!.holdEnd + END_REST_SECONDS,
  anchors: [...admission.anchors, ...addedAnchors],
};

/** Explicit navigation map for the extended route. Call only after the exact base map was admitted. */
export function createExtendedHoldMap() {
  const end = extendedSamaritanAdmission.durationSeconds;
  const map = createHoldMap(end, [rests.opening, ...extendedSamaritanAdmission.anchors, { holdStart: end - END_REST_SECONDS, holdEnd: end }]);
  return { ...map, focusHolds: extendedSamaritanAdmission.anchors as readonly Hold[] };
}

/** Call once on the exact base clip, before creating the animation mixer. */
export function extendRecordedRoute(
  root: Object3D,
  clips: AnimationClip[],
  manifest: SceneManifest,
  /** `continuationCopies: false` lets a bounded replacement field own the scenery: no extension_field_* slabs or tracks are built. */
  options: { continuationCopies?: boolean } = {},
): SceneManifest {
  if (manifest.world !== "samaritan" || manifest.clipName !== admission.clipName
    || manifest.durationSeconds !== admission.durationSeconds
    || JSON.stringify(manifest.anchors) !== JSON.stringify(admission.anchors)) return manifest;
  const clipIndex = clips.findIndex((clip) => clip.name === manifest.clipName);
  const clip = clips[clipIndex];
  const camera = clip?.tracks.find((track) => track.name === "route_camera.position");
  const template = root.getObjectByName("focal_screen");
  const atlas = root.getObjectByName("screen_05");
  const cameraNode = root.getObjectByName("route_camera");
  if (!clip || !camera || !cameraNode || !(template instanceof Mesh) || !(atlas instanceof Mesh)
    || Array.isArray(atlas.material) || root.getObjectByName(FEEDS[0].anchorNode)) {
    throw new Error("Recorded route extension requires the admitted camera and photo panes");
  }
  root.updateMatrixWorld(true);
  if (Math.abs(cameraNode.quaternion.w - 1) > 1e-6 || cameraNode.scale.distanceTo(new Vector3(1, 1, 1)) > 1e-6) {
    throw new Error("Recorded route extension requires the admitted straight camera orientation");
  }
  const previousHold = manifest.anchors![4]!, lastHold = manifest.anchors![5]!;
  const fromTime = previousHold.holdEnd, toTime = lastHold.holdStart;
  const interpolate = (camera as KeyframeTrack & {
    createInterpolant(): { evaluate(time: number): ArrayLike<number> };
  }).createInterpolant();
  const sample = (time: number): number[] => Array.from(interpolate.evaluate(time));
  const from = sample(fromTime), to = sample(toTime), end = sample(clip.duration);
  const delta = to.map((value, axis) => (value - from[axis]!) * DISTANCE_SCALE);
  if (delta[2]! >= -1) {
    throw new Error("Recorded route extension requires a forward depth segment");
  }
  const travel = [
    { time: fromTime, value: from },
    ...Array.from(camera.times).flatMap((time) => time > fromTime && time < toTime ? [{ time, value: sample(time) }] : []),
    { time: toTime, value: to },
  ];
  const extension: Array<{ time: number; value: number[] }> = [];
  const destinations=[
    {x:end[0]!+2.5,y:end[1]!-1,z:end[2]!},
    {x:end[0]!+4,y:end[1]!-1,z:end[2]!+delta[2]!},
    {x:end[0]!+2.5,y:end[1]!-1,z:end[2]!+2*delta[2]!},
    {x:end[0]!+4,y:end[1]!-1,z:end[2]!+3*delta[2]!},
  ];
  for (let index = 0; index < FEEDS.length; index++) {
    const start = admission.durationSeconds + index * (TRAVEL_SECONDS + HOLD_SECONDS);
    for (const frame of travel.slice(1)) {
      const progress = (frame.time - fromTime) / (toTime - fromTime);
      const origin=index===0?{x:end[0]!,y:end[1]!,z:end[2]!}:destinations[index-1]!;
      const destination=destinations[index]!;
      const leg=journeyLeg(progress,origin,destination,index===0?'yx':'forward-x');
      const p=leg.forward,easedDepth=p*p*p*(p*(p*6-15)+10);
      extension.push({
        time: start + progress * TRAVEL_SECONDS,
        value: [leg.x,leg.y,origin.z+(destination.z-origin.z)*easedDepth],
      });
    }
    extension.push({ time: addedAnchors[index]!.holdEnd, value: [destinations[index]!.x,destinations[index]!.y,destinations[index]!.z] });
  }
  extension.push({ time: extendedSamaritanAdmission.durationSeconds, value: extension[extension.length - 1]!.value });
  const append = (track: KeyframeTrack) => {
    const copy = track.clone(), size = track.getValueSize();
    const last = Array.from(track.values.slice(-size));
    const cameraRelative = /^optic_shutter_rig_.*\.position$/.test(track.name);
    copy.times = new Float32Array([...track.times, ...extension.map((frame) => frame.time)]);
    copy.values = new Float32Array([...track.values, ...extension.flatMap((frame) => {
      if (track === camera) return frame.value;
      return last.map((value, axis) => cameraRelative ? value + frame.value[axis]! - end[axis]! : value);
    })]);
    return copy;
  };
  const extended = clip.clone();
  extended.name = CLIP_NAME;
  extended.tracks = clip.tracks.map(append);
  extended.duration = extendedSamaritanAdmission.durationSeconds;
  const extensionStart = admission.durationSeconds;

  // Foreground protection: hide only the static field strips that would sit in
  // front of an extension pane (inside its view pyramid, nearer than the pane).
  // Evaluated on the original field before any continuation copy is added.
  root.updateMatrixWorld(true);
  const wasWorldOffset = cameraNode.getWorldPosition(new Vector3()).sub(cameraNode.position);
  template.geometry.computeBoundingBox();
  const paneSize = template.geometry.boundingBox!.getSize(new Vector3());
  const paneHalfX = paneSize.x / 2 * 1.05 + 0.1, paneHalfY = paneSize.y / 2 * 1.05 + 0.1;
  const FIELD = /^(field_depth_b\d|journey_continuation$)/;
  const fieldGroups: Object3D[] = [];
  root.traverse((node) => { if (FIELD.test(node.name)) fieldGroups.push(node); });
  const hidden: Object3D[] = [];
  const box = new Box3();
  for (const group of fieldGroups) for (const node of group.children) {
    if (!node.name || !node.visible) continue;
    box.setFromObject(node);
    if (box.isEmpty()) continue;
    const blocks = destinations.some((stop) => {
      const camX = stop.x + wasWorldOffset.x, camY = stop.y + wasWorldOffset.y, camZ = stop.z + wasWorldOffset.z;
      const nearest = Math.max(0, camZ - box.max.z), farthest = Math.min(1.5, camZ - box.min.z);
      if (farthest <= 0.02 || nearest >= 1.5) return false;
      const scale = farthest / 1.389473233;
      return box.min.x < camX + paneHalfX * scale && box.max.x > camX - paneHalfX * scale
        && box.min.y < camY + paneHalfY * scale && box.max.y > camY - paneHalfY * scale;
    });
    if (blocks) hidden.push(node);
  }
  // Smooth reveal/removal: per-mesh owned material clones (originals and focus
  // materials are never mutated); opacity tracks replace boolean visibility.
  // Clones live on scene meshes, so disposeObjectTree owns and disposes them.
  const FADE_SECONDS = 1.25;
  const fade = (nodes: Object3D[], tag: string, schedule: (opacity: number) => { times: number[]; values: number[] }) => {
    const owned = new Map<Material, Material>();
    let count = 0;
    for (const node of nodes) node.traverse((child) => {
      if (!(child instanceof Mesh) || Array.isArray(child.material)) return;
      const existing = owned.get(child.material);
      let clone: Material;
      if (existing) clone = existing;
      else {
        clone = child.material.clone();
        clone.transparent = true;
        owned.set(child.material, clone);
      }
      child.material = clone;
      if (existing) return;
      child.name = `${tag}_m${count++}`;
      const { times, values } = schedule(clone.opacity);
      extended.tracks.push(new NumberKeyframeTrack(`${child.name}.material.opacity`, times, values));
    });
  };
  fade(hidden, "extension_blocker", (opacity) => ({
    times: [0, extensionStart, extensionStart + FADE_SECONDS], values: [opacity, opacity, 0],
  }));

  // Bounded depth continuation (standalone default): two copies of the existing deep strip templates
  // (field_depth_b4 + b5_deep, one 30-unit slab each) sharing geometry and
  // materials. Mirrored, jittered and thinned, with a clear corridor around the
  // camera/focus path. Revealed by animation as the camera approaches.
  const slabSource = ["field_depth_b4", "field_depth_b5_deep"].map((name) => root.getObjectByName(name));
  const slabParent = slabSource[0]?.parent;
  const continuationGroups: Group[] = [];
  const corridorPoints = [{ x: end[0]!, y: end[1]!, z: end[2]! }, ...destinations];
  const corridorAt = (z: number) => {
    for (let i = 0; i + 1 < corridorPoints.length; i++) {
      const a = corridorPoints[i]!, b = corridorPoints[i + 1]!;
      if (z <= a.z && z >= b.z && a.z !== b.z) {
        const t = (z - a.z) / (b.z - a.z);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    const final = corridorPoints[corridorPoints.length - 1]!;
    return z < final.z ? final : corridorPoints[0]!;
  };
  const finalZ = destinations[destinations.length - 1]!.z;
  if (options.continuationCopies !== false && slabParent && slabSource.every(Boolean)) {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let v = Math.imul(seed ^ (seed >>> 15), seed | 1);
      v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
    for (let copy = 1; copy <= 2; copy++) {
      const group = new Group();
      group.name = `extension_field_${copy}`;
      for (const source of slabSource) for (const node of source!.children) {
        if (random() < 0.2) continue;
        const x = (node.position.x) * -1 + (random() - 0.5) * 1.2;
        const y = node.position.y * (copy === 2 ? -1 : 1) + (random() - 0.5) * 1.2;
        const z = node.position.z - 30 * copy + (random() - 0.5) * 2.4;
        const corridor = corridorAt(z);
        const radius = 1.1 + 0.05 * Math.max(0, finalZ - z);
        if (Math.hypot(x - corridor.x, y - corridor.y) < radius) continue;
        const clone = node.clone(true);
        clone.traverse((child) => { if (child.name) child.name = `${child.name}_x${copy}`; });
        clone.position.set(x, y, z);
        group.add(clone);
      }
      if (!group.children.length) continue;
      slabParent.add(group);
      continuationGroups.push(group);
      const reveal = extensionStart + (copy - 1) * (TRAVEL_SECONDS + HOLD_SECONDS);
      fade([group], `extension_field_${copy}`, (opacity) => ({
        times: [0, reveal, reveal + FADE_SECONDS], values: [0, 0, opacity],
      }));
    }
  }
  budget.hiddenForeground = hidden.length;
  budget.continuationNodes = continuationGroups.reduce((sum, group) => sum + group.children.length, 0);

  // The focal pane's static dimensions already match the admitted hold lens.
  // Share the existing atlas material and textures, own only two UV geometries.
  const cameraWorld = cameraNode.getWorldPosition(new Vector3());
  const cameraLocal = cameraNode.position;
  const cameraOffset = cameraWorld.sub(cameraLocal);
  for (const [index, feed] of FEEDS.entries()) {
    const geometry = template.geometry.clone(), originalUv = geometry.getAttribute("uv");
    const uv: number[] = [];
    const column = feed.tile % 4, row = Math.floor(feed.tile / 4);
    for (let vertex = 0; vertex < originalUv.count; vertex++) {
      uv.push(column / 4 + 0.0035885167 + originalUv.getX(vertex) * (0.25 - 2 * 0.0035885167),
        row / 4 + 0.0063762069 + originalUv.getY(vertex) * (0.25 - 2 * 0.0063762069));
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    const pane = new Mesh(geometry, atlas.material);
    pane.name = feed.screen;
    const anchor = new Object3D();
    anchor.name = feed.anchorNode;
    const position = new Vector3(destinations[index]!.x,destinations[index]!.y,
      destinations[index]!.z - 1.389473233);
    anchor.position.copy(root.worldToLocal(position.add(cameraOffset)));
    anchor.add(pane);
    root.add(anchor);
  }
  clips[clipIndex] = extended;
  root.updateMatrixWorld(true);
  return {
    ...manifest,
    clipName: extended.name,
    durationSeconds: extended.duration,
    anchors: extendedSamaritanAdmission.anchors.map((anchor) => ({ ...anchor })),
    referenceFrames: manifest.referenceFrames,
  };
}
