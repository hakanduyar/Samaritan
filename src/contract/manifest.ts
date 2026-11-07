import {assetPath} from './assetPath';
/**
 * Consumer-side reader for the producer scene manifest contract
 * (`public/assets/{world}/manifest.json`, schemaVersion 1).
 *
 * This module validates; it never fills in, guesses or repairs producer data.
 * Time values are local to the clip except `sourceSeconds` and
 * `sourceStartSeconds`, which refer to the original source footage.
 */

export const WORLDS = ["samaritan", "machine"] as const;
export type World = (typeof WORLDS)[number];

export function isWorld(value: unknown): value is World {
  return typeof value === "string" && (WORLDS as readonly string[]).includes(value);
}

export interface ReferenceFrame {
  timeSeconds: number;
  sourceSeconds?: number;
  evidencePath: string;
}

export interface SceneManifest {
  schemaVersion: 1 | 2;
  timeBasis?: "authored" | "source" | "authored-local";
  sourceTimeApplicable?: boolean;
  world: World;
  sceneUrl: string;
  cameraName: string;
  clipName: string;
  durationSeconds: number;
  sourceStartSeconds?: number;
  sourceAspectRatio: number;
  focalScreenName: string;
  referenceFrames: ReferenceFrame[];
  backgroundColor?: string;
  anchors?: Array<{screen: string; anchorNode: string; holdStart: number; holdEnd: number}>;
}

export type ManifestValidation =
  | { ok: true; manifest: SceneManifest }
  | { ok: false; errors: string[] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function manifestPathFor(world: World): string {
  return assetPath(`/assets/${world}/manifest.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateManifest(input: unknown, expectedWorld: World): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["manifest is not a JSON object"] };
  }

  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) errors.push("schemaVersion must be 1 or 2");
  const authored = input.timeBasis === "authored" || input.timeBasis === "authored-local";
  if (input.schemaVersion === 2 && !authored) errors.push("schema 2 currently requires authored timeBasis");
  if (authored && input.sourceTimeApplicable === true) errors.push("authored time cannot claim source time");
  const aspect = input.schemaVersion === 2 ? input.framingAspectRatio : input.sourceAspectRatio;
  if (input.world !== expectedWorld) {
    errors.push(`world must be "${expectedWorld}" (got ${JSON.stringify(input.world)})`);
  }
  for (const key of ["sceneUrl", "cameraName", "clipName", "focalScreenName"] as const) {
    if (!isNonEmptyString(input[key])) errors.push(`${key} must be a non-empty string`);
  }

  const duration = input.durationSeconds;
  if (!isFiniteNumber(duration) || duration <= 0) {
    errors.push("durationSeconds must be a finite number > 0");
  }
  if (!authored && (!isFiniteNumber(input.sourceStartSeconds) || input.sourceStartSeconds < 0)) {
    errors.push("sourceStartSeconds must be a finite number >= 0");
  }
  if (!isFiniteNumber(aspect) || aspect <= 0) {
    errors.push("sourceAspectRatio must be a finite number > 0");
  }
  if (input.backgroundColor !== undefined) {
    if (typeof input.backgroundColor !== "string" || !HEX_COLOR.test(input.backgroundColor)) {
      errors.push("backgroundColor, when present, must be #rrggbb");
    }
  }

  const frames = input.referenceFrames;
  if (input.schemaVersion === 2) {
    if (!Array.isArray(input.anchors) || input.anchors.length === 0) errors.push("authored manifest needs anchors");
    else input.anchors.forEach((anchor, index) => {
      if (!isRecord(anchor) || !isNonEmptyString(anchor.screen) || !isNonEmptyString(anchor.anchorNode)
        || !isFiniteNumber(anchor.holdStart) || !isFiniteNumber(anchor.holdEnd)
        || anchor.holdStart < 0 || anchor.holdEnd <= anchor.holdStart
        || (isFiniteNumber(duration) && anchor.holdEnd > duration)) errors.push(`anchors[${index}] invalid`);
    });
  }
  if (!Array.isArray(frames)) {
    errors.push("referenceFrames must be an array");
  } else {
    frames.forEach((frame: unknown, index) => {
      const at = `referenceFrames[${index}]`;
      if (!isRecord(frame)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!isFiniteNumber(frame.timeSeconds) || frame.timeSeconds < 0) {
        errors.push(`${at}.timeSeconds must be a finite number >= 0`);
      } else if (isFiniteNumber(duration) && frame.timeSeconds > duration) {
        errors.push(`${at}.timeSeconds exceeds durationSeconds`);
      }
      if (!authored && !isFiniteNumber(frame.sourceSeconds)) {
        errors.push(`${at}.sourceSeconds must be a finite number`);
      }
      if (!isNonEmptyString(frame.evidencePath)) {
        errors.push(`${at}.evidencePath must be a non-empty string`);
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: { ...input, sourceAspectRatio: aspect } as unknown as SceneManifest };
}

/**
 * Resolves `sceneUrl` relative to the absolute manifest URL. Scenes must be
 * served from the same origin as the manifest (no remote services).
 */
export function resolveSceneUrl(manifestUrl: string, sceneUrl: string): string {
  const base = new URL(manifestUrl);
  const resolved = new URL(sceneUrl, base);
  if (resolved.origin !== base.origin) {
    throw new Error(`sceneUrl resolves to a different origin (${resolved.origin})`);
  }
  return resolved.href;
}
