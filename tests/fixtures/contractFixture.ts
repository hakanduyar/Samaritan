/**
 * TEST-ONLY contract fixture. A three-node GLB (named camera, focal screen,
 * one animated slot) built in memory to exercise the manifest/camera/clip
 * contract. It is never served, never written to public/, and has no visual
 * meaning; it must not be imported by app/ or src/.
 */
import type { Group, AnimationClip } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { SceneManifest, World } from "../../src/contract/manifest";

export interface FixtureOptions {
  cameraName?: string;
  clipName?: string;
  focalName?: string;
  animateCamera?: boolean;
}

export const FIXTURE_DURATION = 4;
/** Camera translation keys at t = 0, 2, 4 (linear). */
export const CAMERA_KEYS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 10],
  [0, 1, 6],
  [2, 1, 2],
];
/** Camera yaw (degrees about +Y) at t = 0, 2, 4. */
export const CAMERA_YAW_DEG = [0, 30, 60] as const;

function yawQuat(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

export function buildContractGlb(options: FixtureOptions = {}): ArrayBuffer {
  const { cameraName = "route_camera", clipName = "route", focalName = "focal_screen", animateCamera = true } =
    options;

  const parts: Float32Array[] = [
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Float32Array([0, 2, 4]),
    new Float32Array(CAMERA_KEYS.flat()),
    new Float32Array([0, 0, 0, 0, 0.5, 0, 0, 1, 0]),
    new Float32Array(CAMERA_YAW_DEG.flatMap((deg) => yawQuat(deg))),
  ];
  const bufferViews: Array<{ buffer: 0; byteOffset: number; byteLength: number }> = [];
  let offset = 0;
  for (const part of parts) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength });
    offset += part.byteLength;
  }
  const bin = new Uint8Array(offset);
  offset = 0;
  for (const part of parts) {
    bin.set(new Uint8Array(part.buffer), offset);
    offset += part.byteLength;
  }

  const FLOAT = 5126;
  const channels = [{ sampler: 1, target: { node: 2, path: "translation" } }];
  if (animateCamera) {
    channels.push(
      { sampler: 0, target: { node: 0, path: "translation" } },
      { sampler: 2, target: { node: 0, path: "rotation" } },
    );
  }

  const json = {
    asset: { version: "2.0", generator: "reference-app test fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: cameraName, camera: 0, translation: [...CAMERA_KEYS[0]!] },
      { name: focalName, mesh: 0, translation: [0, 0, -5] },
      { name: "slot_a", mesh: 0 },
    ],
    cameras: [{ type: "perspective", perspective: { yfov: 0.6, aspectRatio: 1.5, znear: 0.1, zfar: 100 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: FLOAT, count: 3, type: "SCALAR", min: [0], max: [4] },
      { bufferView: 2, componentType: FLOAT, count: 3, type: "VEC3" },
      { bufferView: 3, componentType: FLOAT, count: 3, type: "VEC3" },
      { bufferView: 4, componentType: FLOAT, count: 3, type: "VEC4" },
    ],
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
    animations: [
      {
        name: clipName,
        samplers: [
          { input: 1, output: 2, interpolation: "LINEAR" },
          { input: 1, output: 3, interpolation: "LINEAR" },
          { input: 1, output: 4, interpolation: "LINEAR" },
        ],
        channels,
      },
    ],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  const binStart = 20 + jsonLength;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  bytes.set(bin, binStart + 8);
  return out;
}

export async function parseFixture(options?: FixtureOptions): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const gltf = await new GLTFLoader().parseAsync(buildContractGlb(options), "");
  return { scene: gltf.scene, animations: gltf.animations };
}

export function fixtureManifest(world: World, overrides: Partial<SceneManifest> = {}): SceneManifest {
  return {
    schemaVersion: 1,
    world,
    sceneUrl: `${world}.glb`,
    cameraName: "route_camera",
    clipName: "route",
    durationSeconds: FIXTURE_DURATION,
    sourceStartSeconds: 128,
    sourceAspectRatio: 16 / 9,
    focalScreenName: "focal_screen",
    referenceFrames: [{ timeSeconds: 1, sourceSeconds: 129, evidencePath: "fixture/none.png" }],
    ...overrides,
  };
}
