import { describe, expect, it } from "vitest";

import manifest from "../public/assets/samaritan/manifest.json";
import { MAX_DECODERS, resolveCatalog, selectPrepared } from "../src/player/recordedCatalog";
import { headTriangle, parseRecordedTracking, sampleHeads, type Head } from "../src/player/recordedTracking";

import terminalWalk from "../public/assets/recorded-feeds/terminal-walk/tracking.json";
import s00 from "../public/assets/recorded-feeds/s00/tracking.json";
import porchWalk from "../public/assets/recorded-feeds/porch-walk/tracking.json";
import s01 from "../public/assets/recorded-feeds/s01/tracking.json";
import s02 from "../public/assets/recorded-feeds/s02/tracking.json";
import s03 from "../public/assets/recorded-feeds/s03/tracking.json";
import s06 from "../public/assets/recorded-feeds/s06/tracking.json";
import aircargo from "../public/assets/recorded-feeds/aircargo/tracking.json";

describe("recorded feed catalog", () => {
  const anchors = manifest.anchors;

  it("maps six recorded feeds onto all six anchors without changing their order", () => {
    const entries = resolveCatalog(anchors);
    expect(entries.map((e) => e.anchorIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(entries.map((e) => e.id)).toEqual(["terminal-walk", "porch-walk", "aircargo", "s01", "s02", "s03"]);
    expect(entries.map((e) => e.screen)).toEqual(["screen_01", "screen_02", "screen_03", "screen_04", "screen_05", "focal_screen"]);
    expect(entries[0]).toMatchObject({id:"terminal-walk",screen:"screen_01"});
    entries.forEach((e) => expect(e.holdStart).toBe(anchors[e.anchorIndex]!.holdStart));
  });

  it("skips entries whose anchor is missing or names a different screen", () => {
    expect(resolveCatalog(undefined)).toEqual([]);
    expect(resolveCatalog(anchors.slice(0, 2)).map((e) => e.id)).toEqual(["terminal-walk", "porch-walk"]);
    const swapped = anchors.map((a, i) => (i === 2 ? { ...a, screen: "other" } : a));
    expect(resolveCatalog(swapped).map((e) => e.id)).not.toContain("aircargo");
  });

  it("never prepares more than the current and nearest upcoming decoder", () => {
    const entries = resolveCatalog(anchors);
    for (let t = 0; t <= 110; t += 0.25) expect(selectPrepared(entries, t).length).toBeLessThanOrEqual(MAX_DECODERS);
    expect(selectPrepared(entries, anchors[3]!.holdStart + 0.5)[0]?.id).toBe("s01");
    expect(selectPrepared(entries, 1000)).toEqual([]);
    expect(selectPrepared(entries, anchors[0]!.holdStart).map(e=>e.id)).toContain("terminal-walk");
  });
});

describe("recorded tracking", () => {
  it("keeps per-person styles stable through interpolation without styling vehicles", () => {
    const keyframes = [{ t: 0, x: 0.1, y: 0.2, w: 0.05, h: 0.07, visible: true }, { t: 2, x: 0.4, y: 0.2, w: 0.05, h: 0.07, visible: true }];
    const data = parseRecordedTracking({ duration: 2, tracks: [
      ...[1, 2, 3].map(n => ({ id: `subject-${n}`, entityKind: "person", keyframes })),
      { id: "vehicle-2", entityKind: "vehicle", keyframes },
    ] });
    const initial = sampleHeads(data, 0);
    expect(new Set(initial.slice(0, 3).map(head => head.style)).size).toBe(3);
    for (const time of [0.25, 1, 1.75, 2]) {
      expect(sampleHeads(data, time).map(head => head.style)).toEqual(initial.map(head => head.style));
    }
    expect(initial[3]!.style).toBeUndefined();
  });

  it("parses every shipped track file and types aircargo as a vehicle", () => {
    for (const data of [terminalWalk, porchWalk, s00, s01, s02, s03, s06, aircargo]) expect(() => parseRecordedTracking(data)).not.toThrow();
    expect(aircargo.tracks.every((t) => t.entityKind === "vehicle")).toBe(true);
    for (const data of [terminalWalk, porchWalk, s00, s01, s02, s03]) expect(data.tracks.every((t) => t.entityKind === "person")).toBe(true);
  });

  it("rejects an unknown entityKind", () => {
    const bad = { duration: 1, tracks: [{ id: "a", entityKind: "animal", keyframes: [{ t: 0, x: 0, y: 0, w: 0.1, h: 0.1, visible: true }] }] };
    expect(() => parseRecordedTracking(bad)).toThrow();
  });

  it("carries entityKind through sampling and never extrapolates", () => {
    const data = parseRecordedTracking({
      duration: 4,
      tracks: [{ id: "v", entityKind: "vehicle", keyframes: [{ t: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.1, visible: true }, { t: 3, x: 0.5, y: 0.2, w: 0.2, h: 0.1, visible: true }] }],
    });
    expect(sampleHeads(data, 2)[0]).toMatchObject({ kind: "vehicle" });
    expect(sampleHeads(data, 2)[0]!.x).toBeCloseTo(0.3, 10);
    expect(sampleHeads(data, 0.5)).toEqual([]);
    expect(sampleHeads(data, 3.5)).toEqual([]);
  });

  it("keeps the head triangle inside the frame, even for a head at the top edge", () => {
    const head: Head = { x: 0.5, y: 0, w: 0.02, h: 0.04, kind: "person" };
    const g = headTriangle(960, 540, head);
    expect(g.baseY).toBeGreaterThanOrEqual(0);
    expect(g.apexY).toBeGreaterThan(g.baseY);
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.right).toBeLessThanOrEqual(960);
  });
});
