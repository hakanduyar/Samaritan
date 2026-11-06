import { describe, expect, it } from "vitest";

import { isWorld, manifestPathFor, resolveSceneUrl, validateManifest } from "../src/contract/manifest";
import { fixtureManifest } from "./fixtures/contractFixture";

describe("manifest contract", () => {
  it("accepts a complete schemaVersion 1 manifest", () => {
    const result = validateManifest(fixtureManifest("machine"), "machine");
    expect(result.ok).toBe(true);
  });

  it("accepts an optional #rrggbb backgroundColor and rejects other forms", () => {
    expect(validateManifest(fixtureManifest("machine", { backgroundColor: "#0a0b0c" }), "machine").ok).toBe(true);
    expect(validateManifest(fixtureManifest("machine", { backgroundColor: "black" }), "machine").ok).toBe(false);
  });

  it("rejects a manifest for another world", () => {
    const result = validateManifest(fixtureManifest("machine"), "samaritan");
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining("world must be \"samaritan\"")] });
  });

  it.each([
    ["schemaVersion", 2],
    ["sceneUrl", ""],
    ["cameraName", undefined],
    ["clipName", 3],
    ["focalScreenName", ""],
    ["durationSeconds", 0],
    ["durationSeconds", Number.NaN],
    ["sourceStartSeconds", -1],
    ["sourceAspectRatio", 0],
    ["referenceFrames", {}],
  ])("rejects invalid %s (%s)", (key, value) => {
    const manifest = { ...fixtureManifest("samaritan"), [key]: value };
    const result = validateManifest(manifest, "samaritan");
    expect(result.ok).toBe(false);
  });

  it("rejects reference frames outside the clip or missing evidence", () => {
    const late = fixtureManifest("samaritan", {
      referenceFrames: [{ timeSeconds: 5, sourceSeconds: 133, evidencePath: "x" }],
    });
    expect(validateManifest(late, "samaritan").ok).toBe(false);
    const noEvidence = { ...fixtureManifest("samaritan"), referenceFrames: [{ timeSeconds: 1, sourceSeconds: 1 }] };
    expect(validateManifest(noEvidence, "samaritan").ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateManifest(null, "samaritan").ok).toBe(false);
    expect(validateManifest([], "samaritan").ok).toBe(false);
  });

  it("resolves relative sceneUrl against the manifest URL and refuses other origins", () => {
    const manifestUrl = "http://localhost:4000/assets/samaritan/manifest.json";
    expect(resolveSceneUrl(manifestUrl, "samaritan.glb")).toBe("http://localhost:4000/assets/samaritan/samaritan.glb");
    expect(resolveSceneUrl(manifestUrl, "../shared/a.glb")).toBe("http://localhost:4000/assets/shared/a.glb");
    expect(() => resolveSceneUrl(manifestUrl, "https://cdn.example.com/a.glb")).toThrow(/different origin/);
  });

  it("maps worlds to the contract path", () => {
    expect(manifestPathFor("samaritan")).toBe("/assets/samaritan/manifest.json");
    expect(manifestPathFor("machine")).toBe("/assets/machine/manifest.json");
    expect(isWorld("machine")).toBe(true);
    expect(isWorld("unknown-world")).toBe(false);
  });
});
