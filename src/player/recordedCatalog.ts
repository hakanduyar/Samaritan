/**
 * Recorded-feed catalog: which public manifest anchor shows which recorded excerpt.
 * Hold windows are never stored here; they come from the public manifest anchors.
 * Anchor index 0 (screen_01, the opening pane) has its own recorded excerpt
 * (terminal-walk); the other anchors follow in route order.
 */
export interface AnchorLike { screen: string; holdStart: number; holdEnd: number }

export interface RecordedCatalogEntry {
  id: string;
  /** Index into manifest.anchors in the original six-stop order. */
  anchorIndex: number;
  /** Anchor screen name; must match the manifest or the entry is skipped.
   *  The scene node with this name is itself the image mesh (bound directly). */
  screen: string;
}

export const RECORDED_CATALOG: readonly RecordedCatalogEntry[] = [
  { id: "terminal-walk", anchorIndex: 0, screen: "screen_01" },
  { id: "porch-walk", anchorIndex: 1, screen: "screen_02" },
  { id: "aircargo", anchorIndex: 2, screen: "screen_03" },
  { id: "s01", anchorIndex: 3, screen: "screen_04" },
  { id: "s02", anchorIndex: 4, screen: "screen_05" },
  { id: "s03", anchorIndex: 5, screen: "focal_screen" },
  // Opt-in extended itinerary only (?itinerary=extended); skipped when the manifest has six anchors.
  { id: "harbor", anchorIndex: 6, screen: "extension_screen_07" },
  { id: "s04", anchorIndex: 7, screen: "extension_screen_08" },
  { id: "s05", anchorIndex: 8, screen: "extension_screen_09" },
  { id: "s06", anchorIndex: 9, screen: "extension_screen_10" },
];

export interface ResolvedRecordedEntry extends RecordedCatalogEntry {
  holdStart: number;
  holdEnd: number;
  video: string;
  poster: string;
  tracking: string;
}

/** Route seconds before the hold at which the decoder is created and preloads. */
export const PREPARE_LEAD_SECONDS = 12;
/** Route seconds before the hold at which playback starts. */
export const PLAY_LEAD_SECONDS = 5;
/** Route seconds after the hold during which playback continues. */
export const TRAIL_SECONDS = 3;
/** Hard bound on simultaneously prepared decoders: current plus nearest upcoming. */
export const MAX_DECODERS = 2;

/** Entries whose anchor exists and matches, in route order. Missing or mismatched anchors are skipped. */
export function resolveCatalog(anchors: readonly AnchorLike[] | undefined): ResolvedRecordedEntry[] {
  const out: ResolvedRecordedEntry[] = [];
  for (const entry of RECORDED_CATALOG) {
    const anchor = anchors?.[entry.anchorIndex];
    if (!anchor || anchor.screen !== entry.screen || !Number.isFinite(anchor.holdStart) || !Number.isFinite(anchor.holdEnd)) continue;
    const base = `/assets/recorded-feeds/${entry.id}`;
    out.push({ ...entry, holdStart: anchor.holdStart, holdEnd: anchor.holdEnd, video: `${base}/loop.mp4`, poster: `${base}/poster.jpg`, tracking: `${base}/tracking.json` });
  }
  return out.sort((a, b) => a.holdStart - b.holdStart);
}

export function inWindow(entry: ResolvedRecordedEntry, time: number, lead: number): boolean {
  return time >= entry.holdStart - lead && time <= entry.holdEnd + TRAIL_SECONDS;
}

/** At most MAX_DECODERS entries inside the prepare window, nearest to their hold first. */
export function selectPrepared(entries: readonly ResolvedRecordedEntry[], time: number, max = MAX_DECODERS): ResolvedRecordedEntry[] {
  const distance = (e: ResolvedRecordedEntry) => Math.max(e.holdStart - time, time - e.holdEnd, 0);
  return entries
    .filter((e) => inWindow(e, time, PREPARE_LEAD_SECONDS))
    .sort((a, b) => distance(a) - distance(b) || a.holdStart - b.holdStart)
    .slice(0, max);
}
