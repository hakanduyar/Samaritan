"use client";
import { useEffect, useState } from "react";

/** A timed title sequence, not a network progress indicator. */
export function Startup({ ready, onComplete }: { ready: boolean; onComplete(): void }) {
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let elapsed = 0;
    let previous: number | null = null;
    let raf = 0;
    let cancelled = false;
    const visibility = () => { previous = null; };
    const tick = (now: number) => {
      if (cancelled) return;
      if (!document.hidden) {
        if (previous !== null) elapsed += Math.min(now - previous, 100);
        previous = now;
        setStep(elapsed < 400 ? -1 : elapsed < 1100 ? 0 : elapsed < 1800 ? 1 : elapsed < 2500 ? 2 : elapsed < 3300 ? 3 : 4);
        if (elapsed >= 4500) { setDone(true); onComplete(); return; }
      } else previous = null;
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", visibility);
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility); };
  }, [ready, onComplete]);
  if (done) return null;
  return <div className="sam-startup" role="status" aria-label={ready ? "Startup sequence" : "Loading"}>
    <div className={ready ? "sam-symbol" : "sam-symbol waiting"} />
    <div className="sam-command">{step < 0 ? "" : ["WHAT", "ARE", "YOUR", "COMMANDS", "SAMARITAN"][step]}</div>
    <div className="sam-underline" />
  </div>;
}
