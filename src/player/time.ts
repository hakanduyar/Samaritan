/**
 * Canonical clip time. Every rendered state is a pure function of one number:
 * seconds from the start of the authored clip. Input (wheel, keys, playback,
 * QA scrubber) only ever changes that number.
 */

export type PlayerMode = "reference" | "interactive";

export type QueryRecord = Record<string, string | string[] | undefined>;

export interface PlayerParams {
  mode: PlayerMode;
  /** Requested clip time from `?t=`; null when absent. */
  requestedTime: number | null;
  /** QA controls; only honoured together with `mode=reference`. */
  qa: boolean;
  /** Opt-in playback on load (interactive mode only; reduced motion wins). */
  autoplay: boolean;
  errors: string[];
}

/** Wheel distance (CSS px) that traverses one full clip. */
export const WHEEL_PIXELS_PER_CLIP = 24000;
const WHEEL_LINE_PX = 16;

/** Exponential approach rate (1/s) for interactive easing of displayed time. */
export const EASE_RATE = 10;
export const SETTLE_EPSILON = 1e-4;

const STRICT_DECIMAL = /^\d+(?:\.\d+)?$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseTimeParam(raw: string | undefined): number | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  if (!STRICT_DECIMAL.test(raw)) return "invalid";
  const value = Number(raw);
  return Number.isFinite(value) ? value : "invalid";
}

export function parsePlayerParams(query: QueryRecord): PlayerParams {
  const errors: string[] = [];
  const mode: PlayerMode = first(query.mode) === "reference" ? "reference" : "interactive";
  const parsed = parseTimeParam(first(query.t));
  let requestedTime: number | null = null;
  if (parsed === "invalid") {
    errors.push(`t must be a non-negative decimal number of seconds (got "${first(query.t)}")`);
  } else {
    requestedTime = parsed;
  }
  return {
    mode,
    requestedTime,
    qa: mode === "reference" && first(query.qa) === "1",
    autoplay: mode === "interactive" && first(query.autoplay) === "1",
    errors,
  };
}

/** Stable string form used by DOM markers: fixed 6 decimals (microseconds). */
export function formatTime(seconds: number): string {
  return seconds.toFixed(6);
}

export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(seconds, 0), duration);
}

/** Converts a wheel event delta to a signed clip-time delta. */
export function wheelDeltaSeconds(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
  duration: number,
): number {
  const pixels =
    deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * viewportHeight : deltaY;
  return (pixels / WHEEL_PIXELS_PER_CLIP) * duration;
}

export type KeyCommand =
  | { type: "step"; seconds: number }
  | { type: "jump"; to: "start" | "end" }
  | { type: "toggle" }
  | null;

export const ARROW_STEP_SECONDS = 0.25;
export const PAGE_STEP_SECONDS = 1;

export function keyCommand(key: string): KeyCommand {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return { type: "step", seconds: ARROW_STEP_SECONDS };
    case "ArrowUp":
    case "ArrowLeft":
      return { type: "step", seconds: -ARROW_STEP_SECONDS };
    case "PageDown":
      return { type: "step", seconds: PAGE_STEP_SECONDS };
    case "PageUp":
      return { type: "step", seconds: -PAGE_STEP_SECONDS };
    case "Home":
      return { type: "jump", to: "start" };
    case "End":
      return { type: "jump", to: "end" };
    case " ":
    case "k":
      return { type: "toggle" };
    default:
      return null;
  }
}

/** Frame-rate independent approach of `current` toward `target`. */
export function easeToward(current: number, target: number, dtSeconds: number): number {
  const next = current + (target - current) * (1 - Math.exp(-EASE_RATE * dtSeconds));
  return Math.abs(target - next) < SETTLE_EPSILON ? target : next;
}
