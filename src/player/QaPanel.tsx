"use client";

import { useEffect, useState } from "react";

import type { SceneManifest } from "../contract/manifest";
import type { PlayerController, PlayerSnapshot } from "./runtime";
import { formatTime } from "./time";

const FRAME_STEP = 1 / 60;

/** Review-only controls; rendered solely for `?mode=reference&qa=1`. */
export function QaPanel({ controller, manifest }: { controller: PlayerController; manifest: SceneManifest }) {
  const [snap, setSnap] = useState<PlayerSnapshot | null>(() => controller.getSnapshot());
  useEffect(() => controller.subscribe(setSnap), [controller]);
  if (!snap) return null;

  const authored = manifest.timeBasis === "authored" || manifest.timeBasis === "authored-local" || manifest.sourceTimeApplicable === false;
  const sourceTime = authored ? null : (manifest.sourceStartSeconds ?? 0) + snap.time;

  return (
    <div className="ref-qa" data-reference-qa="">
      <button type="button" onClick={() => controller.togglePlay()}>
        {snap.playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={() => controller.seek(snap.time - FRAME_STEP)}>
        −1/60
      </button>
      <button type="button" onClick={() => controller.seek(snap.time + FRAME_STEP)}>
        +1/60
      </button>
      <input
        type="range"
        aria-label="Clip time"
        min={0}
        max={snap.duration}
        step={0.001}
        value={snap.time}
        onChange={(event) => controller.seek(Number(event.currentTarget.value))}
      />
      <span className="ref-qa-time">
        {authored ? "authored local " : ""}t={formatTime(snap.time)} / {formatTime(snap.duration)}{sourceTime === null ? "" : ` · source≈${sourceTime.toFixed(3)}s`}
      </span>
      {manifest.referenceFrames.map((frame) => (
        <button
          key={`${frame.timeSeconds}-${frame.evidencePath}`}
          type="button"
          title={frame.evidencePath}
          onClick={() => controller.seek(frame.timeSeconds)}
        >
          ref {frame.timeSeconds.toFixed(3)}
        </button>
      ))}
    </div>
  );
}
