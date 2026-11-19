import { describe, expect, it } from "vitest";

import {
  advanceTouchTrip,
  createTouchTrip,
  hasTouchCapability,
  swipeDirection,
  touchStop,
} from "../src/player/touchNavigation";

const holds = [
  { holdStart: 2, holdEnd: 3 },
  { holdStart: 6, holdEnd: 7 },
];

describe("touch navigation", () => {
  it("maps a vertical swipe to a direction and ignores short or sideways moves", () => {
    expect(swipeDirection(0, -80)).toBe(1);
    expect(swipeDirection(0, 80)).toBe(-1);
    expect(swipeDirection(0, -20)).toBe(0);
    expect(swipeDirection(90, -100)).toBe(0);
  });

  it("targets exactly the next focus stop, then the clip endpoint", () => {
    expect(touchStop(0, 1, 10, holds)).toBe(2);
    expect(touchStop(2, 1, 10, holds)).toBe(6);
    expect(touchStop(6, 1, 10, holds)).toBe(10);
    expect(touchStop(7, -1, 10, holds)).toBe(3);
    expect(touchStop(6, -1, 10, holds)).toBe(3);
    expect(touchStop(2, -1, 10, holds)).toBe(0);
  });

  it("settles on the destination from elapsed time, independent of frame size", () => {
    for (const step of [1 / 60, 0.5]) {
      const trip = createTouchTrip(0, 10);
      let position = 0;
      for (let i = 0; i < 1000 && trip.elapsed < trip.duration; i++) position = advanceTouchTrip(trip, step);
      expect(position).toBe(10);
      expect(trip.elapsed).toBe(trip.duration);
    }
    const trip = createTouchTrip(0, 10);
    const early = advanceTouchTrip(trip, 0.1);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(5);
  });

  it("detects touch from pointer coarseness or touch points, not viewport size", () => {
    expect(hasTouchCapability({ matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) })).toBe(true);
    expect(hasTouchCapability({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 5 } })).toBe(true);
    expect(hasTouchCapability({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 0 } })).toBe(false);
  });
});
