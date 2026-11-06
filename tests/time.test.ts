import { describe, expect, it } from "vitest";

import { letterbox } from "../src/player/letterbox";
import {
  WHEEL_PIXELS_PER_CLIP,
  clampTime,
  easeToward,
  formatTime,
  keyCommand,
  parsePlayerParams,
  parseTimeParam,
  wheelDeltaSeconds,
} from "../src/player/time";

describe("player params", () => {
  it("parses reference mode with an exact time", () => {
    expect(parsePlayerParams({ mode: "reference", t: "2.125" })).toEqual({
      mode: "reference",
      requestedTime: 2.125,
      qa: false,
      autoplay: false,
      errors: [],
    });
  });

  it("only honours qa in reference mode and autoplay in interactive mode", () => {
    expect(parsePlayerParams({ qa: "1" }).qa).toBe(false);
    expect(parsePlayerParams({ mode: "reference", qa: "1" }).qa).toBe(true);
    expect(parsePlayerParams({ autoplay: "1" }).autoplay).toBe(true);
    expect(parsePlayerParams({ mode: "reference", autoplay: "1" }).autoplay).toBe(false);
  });

  it("is strict about t", () => {
    expect(parseTimeParam(undefined)).toBeNull();
    expect(parseTimeParam("0")).toBe(0);
    for (const bad of ["-1", "1e3", "0x10", "abc", "1.", " 1"]) expect(parseTimeParam(bad)).toBe("invalid");
    expect(parsePlayerParams({ mode: "reference", t: "abc" }).errors).toHaveLength(1);
    expect(parsePlayerParams({ mode: "reference", t: ["1.5", "2"] }).requestedTime).toBe(1.5);
  });

  it("formats marker time stably", () => {
    expect(formatTime(1)).toBe("1.000000");
    expect(formatTime(2.1234567)).toBe("2.123457");
  });
});

describe("scrub mapping", () => {
  it("is linear and symmetric so reverse input returns to the same time", () => {
    const duration = 7.5;
    const forward = wheelDeltaSeconds(120, 0, 900, duration);
    expect(wheelDeltaSeconds(-120, 0, 900, duration)).toBe(-forward);
    expect(wheelDeltaSeconds(WHEEL_PIXELS_PER_CLIP, 0, 900, duration)).toBe(duration);
    expect(wheelDeltaSeconds(3, 1, 900, duration)).toBe(wheelDeltaSeconds(48, 0, 900, duration));
    expect(wheelDeltaSeconds(1, 2, 900, duration)).toBe(wheelDeltaSeconds(900, 0, 900, duration));
  });

  it("clamps to the clip", () => {
    expect(clampTime(-1, 4)).toBe(0);
    expect(clampTime(9, 4)).toBe(4);
    expect(clampTime(Number.NaN, 4)).toBe(0);
  });

  it("maps keys to time commands only", () => {
    expect(keyCommand("ArrowDown")).toEqual({ type: "step", seconds: 0.25 });
    expect(keyCommand("PageUp")).toEqual({ type: "step", seconds: -1 });
    expect(keyCommand("End")).toEqual({ type: "jump", to: "end" });
    expect(keyCommand(" ")).toEqual({ type: "toggle" });
    expect(keyCommand("a")).toBeNull();
  });

  it("eases monotonically and settles exactly on target", () => {
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const next = easeToward(t, 2, 1 / 60);
      expect(next).toBeGreaterThanOrEqual(t);
      t = next;
    }
    expect(t).toBe(2);
    expect(easeToward(1, 1, 0.016)).toBe(1);
  });
});

describe("letterbox", () => {
  it("pillarboxes a wide container", () => {
    expect(letterbox(2000, 900, 16 / 9)).toEqual({ x: 200, y: 0, width: 1600, height: 900 });
  });
  it("letterboxes a tall container", () => {
    expect(letterbox(1000, 1000, 16 / 9)).toEqual({ x: 0, y: 218, width: 1000, height: 563 });
  });
  it("fills an exact-aspect container and handles empty input", () => {
    expect(letterbox(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(letterbox(0, 500, 1.5)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
