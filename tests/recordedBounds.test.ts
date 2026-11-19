import { expect, it } from "vitest";
import { parseRecordedTracking, sampleHeads } from "../src/player/recordedTracking";

const frame = { t: 0, x: 0.2, y: 0.2, w: 0.1, h: 0.1, visible: true };
const data = (overrides: Partial<typeof frame>) => ({ duration: 1, tracks: [{ id: "person-1", entityKind: "person", keyframes: [{ ...frame, ...overrides }] }] });

it("retains full coordinates for heads intersecting each image edge", () => {
  for (const bounds of [{ x: -0.05 }, { x: 0.95 }, { y: -0.05 }, { y: 0.95 }]) {
    const parsed = parseRecordedTracking(data(bounds));
    expect(sampleHeads(parsed, 0)[0]).toMatchObject(bounds);
  }
});

it("rejects wholly outside, degenerate and non-finite visible bounds", () => {
  for (const bounds of [{ x: -0.1 }, { x: 1 }, { y: -0.1 }, { y: 1 }, { w: 0 }, { h: 0 }, { w: 1.1 }, { h: -0.1 }, { x: NaN }, { y: Infinity }]) {
    expect(() => parseRecordedTracking(data(bounds))).toThrow();
  }
});

it("keeps invisible coordinates bounded and preserves timestamp validation", () => {
  expect(() => parseRecordedTracking(data({ x: -0.1, visible: false }))).not.toThrow();
  for (const bounds of [{ x: -1.1, visible: false }, { y: 2.1, visible: false }, { t: -1 }, { t: 2 }]) {
    expect(() => parseRecordedTracking(data(bounds))).toThrow();
  }
  const unordered = data({});
  unordered.tracks[0]!.keyframes.push({ ...frame });
  expect(() => parseRecordedTracking(unordered)).toThrow();
});
