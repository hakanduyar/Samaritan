import { describe, expect, it } from "vitest";
import admission from "../src/player/holdAdmission.json";
import { createExtendedHoldMap, extendedSamaritanAdmission } from "../src/player/extendRecordedRoute";
import { resolveCatalog } from "../src/player/recordedCatalog";

describe("extended recorded itinerary", () => {
  const extended = extendedSamaritanAdmission;

  it("appends four ordered stops and keeps the original six unchanged", () => {
    expect(extended.anchors.slice(0, 6)).toEqual(admission.anchors);
    expect(extended.anchors.slice(6).map((a) => a.screen)).toEqual(
      ["extension_screen_07", "extension_screen_08", "extension_screen_09", "extension_screen_10"]);
    for (let i = 1; i < extended.anchors.length; i++) {
      expect(extended.anchors[i]!.holdStart).toBeGreaterThan(extended.anchors[i - 1]!.holdEnd);
    }
    expect(extended.durationSeconds).toBeGreaterThan(extended.anchors[9]!.holdEnd);
  });

  it("builds a bounded explicit navigation map over all ten holds", () => {
    const map = createExtendedHoldMap();
    expect(map.focusHolds).toHaveLength(10);
    const last = extended.anchors[9]!;
    expect(map.toClip(map.toNavigation(last.holdStart))).toBeCloseTo(last.holdStart, 6);
    expect(map.duration).toBeGreaterThan(0);
  });

  it("maps the new recorded feeds only when the extended anchors exist", () => {
    expect(resolveCatalog(admission.anchors).map((e) => e.id)).toEqual(["terminal-walk", "s00", "aircargo", "s01", "s02", "s03"]);
    expect(resolveCatalog(extended.anchors).map((e) => e.id).slice(6)).toEqual(["harbor", "s04", "s05", "s06"]);
  });
});
