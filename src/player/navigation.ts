/** Bounds user-controlled clip traversal, not the imported camera or clip. */
export const MAX_NAVIGATION_RATE = 1.25;
export const MAX_NAVIGATION_ACCELERATION = 2.5;
export const MAX_PENDING_SECONDS = 0.6;
export const HOLD_DELAY_SECONDS = 0.2;

export function navigationTarget(current: number, target: number, delta: number): number {
  // Reverse intention cancels queued forward travel immediately. Velocity then
  // brakes normally; the imported path is never replaced or jumped.
  const base = delta * (target - current) < 0 ? current : target;
  return Math.max(current - MAX_PENDING_SECONDS, Math.min(current + MAX_PENDING_SECONDS, base + delta));
}

export function advanceNavigation(current: number, target: number, velocity: number, dt: number) {
  let remaining = Math.max(0, Math.min(dt, 0.1));
  while (remaining > 1e-8) {
    const step = Math.min(remaining, 1 / 120);
    const gap = target - current;
    const brake = Math.max(0, Math.sqrt(2 * MAX_NAVIGATION_ACCELERATION * Math.abs(gap)) - MAX_NAVIGATION_ACCELERATION * step);
    const wanted = Math.sign(gap) * Math.min(MAX_NAVIGATION_RATE, brake, Math.abs(gap) * 8);
    const change = MAX_NAVIGATION_ACCELERATION * step;
    const nextVelocity = velocity + Math.max(-change, Math.min(change, wanted - velocity));
    const next = current + nextVelocity * step;
    if (Math.abs(gap) < 1e-4 && Math.abs(nextVelocity) <= change) {
      current = target; velocity = 0;
    } else {
      current = next; velocity = nextVelocity;
    }
    remaining -= step;
  }
  return { current, velocity };
}
