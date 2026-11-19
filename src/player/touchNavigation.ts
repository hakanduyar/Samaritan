import { focusEntry, type Hold } from "./holdMapping";

const TAP_SLOP = 12;
const SWIPE_DISTANCE = 44;
const VERTICAL_DOMINANCE = 1.4;

interface TouchCapabilityHost {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { maxTouchPoints?: number };
}

/** Coarse pointer or touch hardware; viewport size is deliberately not consulted. */
export function hasTouchCapability(win: TouchCapabilityHost): boolean {
  if (win.matchMedia?.("(pointer: coarse)").matches) return true;
  if (win.matchMedia?.("(any-pointer: coarse)").matches) return true;
  return (win.navigator?.maxTouchPoints ?? 0) > 0;
}

export function isTouchTap(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) <= TAP_SLOP;
}

/** +1 advances (finger moves up), -1 goes back, 0 when too short or not vertical enough. */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  const vertical = Math.abs(dy);
  if (vertical < SWIPE_DISTANCE || vertical < Math.abs(dx) * VERTICAL_DOMINANCE) return 0;
  return dy < 0 ? 1 : -1;
}

/** Next focus stop in the swipe direction, or the clip endpoint when none remains. */
export function touchStop(time: number, direction: -1 | 1, duration: number, holds: readonly Hold[]): number {
  const endpoint = direction === 1 ? duration : 0;
  return focusEntry(time, endpoint, holds) ?? endpoint;
}

export function createTouchTrip(from: number, to: number) {
  const distance = Math.abs(to - from);
  return { from, to, duration: Math.max(2, Math.min(4.5, 1.25 + distance / 5)), elapsed: 0 };
}

export type TouchTrip = ReturnType<typeof createTouchTrip>;

/** Advances by elapsed seconds and returns the eased position; lands exactly on `to`. */
export function advanceTouchTrip(trip: TouchTrip, elapsed: number): number {
  trip.elapsed = Math.min(trip.duration, trip.elapsed + Math.max(0, elapsed));
  if (trip.elapsed === trip.duration) return trip.to;
  const progress = (1 - Math.cos(Math.PI * trip.elapsed / trip.duration)) / 2;
  return trip.from + (trip.to - trip.from) * progress;
}
