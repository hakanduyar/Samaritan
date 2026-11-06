import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createSceneRig } from "../src/player/sceneRig";
import { fixtureManifest, parseFixture } from "./fixtures/contractFixture";

const contract = fixtureManifest("samaritan");

function pose(rig: { camera: { getWorldPosition(v: Vector3): Vector3; getWorldQuaternion(q: Quaternion): Quaternion } }) {
  return {
    position: rig.camera.getWorldPosition(new Vector3()).toArray(),
    quaternion: rig.camera.getWorldQuaternion(new Quaternion()).toArray(),
  };
}

describe("scene rig (imported camera + clip)", () => {
  it("uses the GLB's own named camera object", async () => {
    const { scene, animations } = await parseFixture();
    const rig = createSceneRig(scene, animations, contract);
    expect(rig.camera.isPerspectiveCamera).toBe(true);
    expect(rig.camera.name).toBe("route_camera");
    expect(scene.getObjectByName("route_camera")).toBe(rig.camera);
    expect(rig.duration).toBe(4);
  });

  it("evaluates the authored clip at exact times", async () => {
    const { scene, animations } = await parseFixture();
    const rig = createSceneRig(scene, animations, contract);

    rig.seek(1);
    const p1 = rig.camera.getWorldPosition(new Vector3());
    expect(p1.x).toBeCloseTo(0, 6);
    expect(p1.y).toBeCloseTo(1, 6);
    expect(p1.z).toBeCloseTo(8, 6);
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (15 * Math.PI) / 180);
    expect(rig.camera.getWorldQuaternion(new Quaternion()).angleTo(yaw)).toBeLessThan(1e-6);

    rig.seek(3);
    expect(rig.camera.getWorldPosition(new Vector3()).toArray().map((v) => +v.toFixed(6))).toEqual([1, 1, 4]);

    // End of clip evaluates the final key (no wrap to start).
    rig.seek(4);
    expect(rig.camera.getWorldPosition(new Vector3()).toArray().map((v) => +v.toFixed(6))).toEqual([2, 1, 2]);

    // Animated scene objects come from the same clip.
    rig.seek(2);
    expect(scene.getObjectByName("slot_a")!.position.y).toBeCloseTo(0.5, 6);
  });

  it("is history-independent: forward/reverse seeks return identical poses", async () => {
    const { scene, animations } = await parseFixture();
    const rig = createSceneRig(scene, animations, contract);
    rig.seek(2.5);
    const direct = pose(rig);
    for (const t of [0, 0.7, 4, 3.9, 1.2, 4, 0]) rig.seek(t);
    rig.seek(2.5);
    expect(pose(rig)).toEqual(direct);
  });

  it("clamps out-of-range seeks to the clip", async () => {
    const { scene, animations } = await parseFixture();
    const rig = createSceneRig(scene, animations, contract);
    expect(rig.seek(-3)).toBe(0);
    expect(rig.seek(99)).toBe(4);
    expect(rig.seek(Number.NaN)).toBe(0);
  });

  it("rejects scenes that break the contract", async () => {
    const base = await parseFixture();
    expect(() => createSceneRig(base.scene, base.animations, { ...contract, cameraName: "nope" })).toThrow(
      /camera "nope" not found/,
    );
    expect(() => createSceneRig(base.scene, base.animations, { ...contract, clipName: "other" })).toThrow(
      /animation "other" not found \(available: "route"\)/,
    );
    expect(() => createSceneRig(base.scene, base.animations, { ...contract, durationSeconds: 5 })).toThrow(
      /does not match manifest durationSeconds/,
    );
    expect(() => createSceneRig(base.scene, base.animations, { ...contract, focalScreenName: "missing" })).toThrow(
      /focal screen "missing" not found/,
    );
    expect(() => createSceneRig(base.scene, base.animations, { ...contract, cameraName: "focal_screen" })).toThrow(
      /exactly one perspective camera/,
    );

    const still = await parseFixture({ animateCamera: false });
    expect(() => createSceneRig(still.scene, still.animations, contract)).toThrow(/no track driving the camera/);
  });

  it("stops evaluating after dispose", async () => {
    const { scene, animations } = await parseFixture();
    const rig = createSceneRig(scene, animations, contract);
    rig.seek(2);
    rig.dispose();
    scene.updateMatrixWorld(true);
    const afterDispose = pose(rig);
    expect(rig.seek(4)).toBe(0);
    scene.updateMatrixWorld(true);
    expect(pose(rig)).toEqual(afterDispose);
  });
});
