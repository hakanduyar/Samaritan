/**
 * Authored marker tracks for a recorded feed. Bounds are normalized, top-left
 * origin. Tracks are hand-authored for this project, not live inference, and
 * carry no semantic label beyond the geometric kind of the tracked entity.
 */
export type EntityKind = "person" | "vehicle";
export interface TrackKeyframe { t: number; x: number; y: number; w: number; h: number; visible: boolean }
export interface TrackingTrack { id: string; role?: string; entityKind?: EntityKind; keyframes: TrackKeyframe[] }
/**
 * Optional authored foreground mask: a normalized polygon (top-left origin)
 * covering part of the frame during [start, end]. Marker pixels inside it are
 * clipped; video pixels are never touched. Scoped to trackIds when given.
 */
export interface OcclusionMask { id?: string; trackIds?: string[]; start: number; end: number; polygon: Array<[number, number]> }
export interface RecordedTracking { duration: number; tracks: TrackingTrack[]; occluders?: OcclusionMask[] }
/**
 * Visual style only. Fan-reference-inspired display variation, authored per
 * track; it is not a taxonomy and carries no meaning about the subject.
 */
export type MarkerStyle = "open-triangle" | "circle-frame" | "circle-red-triangle";
export interface Head { trackId?: string; x: number; y: number; w: number; h: number; kind: EntityKind; style?: MarkerStyle }

const BOUNDS_EPSILON = 1e-5;
const STYLE_CYCLE: readonly MarkerStyle[] = ["circle-frame", "circle-red-triangle", "open-triangle"];

/** Stable authored style from the track id's trailing number (subject-01, -02, ...); no per-frame state. */
export function markerStyleForTrack(id: string): MarkerStyle {
  const n = /(\d+)$/.exec(id);
  return n ? STYLE_CYCLE[(Number(n[1]) + STYLE_CYCLE.length - 1) % STYLE_CYCLE.length]! : "open-triangle";
}

export function parseRecordedTracking(value: unknown): RecordedTracking {
  const data = value as RecordedTracking | null;
  if (!data || !Number.isFinite(data.duration) || data.duration <= 0 || !Array.isArray(data.tracks)) {
    throw new Error("Invalid recorded tracking");
  }
  const ids = new Set<string>();
  for (const track of data.tracks) {
    if (
      !track || typeof track.id !== "string" || ids.has(track.id) || !Array.isArray(track.keyframes) || track.keyframes.length === 0
      || (track.entityKind !== undefined && track.entityKind !== "person" && track.entityKind !== "vehicle")
    ) {
      throw new Error("Invalid recorded track");
    }
    ids.add(track.id);
    let previous = -1;
    for (const f of track.keyframes) {
      const finite = f && [f.t, f.x, f.y, f.w, f.h].every(Number.isFinite);
      if (
        !finite || typeof f.visible !== "boolean" || f.t < 0 || f.t > data.duration || f.t <= previous
        || f.x < 0 || f.y < 0 || f.w < 0 || f.h < 0
        || (f.visible && (f.w === 0 || f.h === 0))
        || f.x + f.w > 1 + BOUNDS_EPSILON || f.y + f.h > 1 + BOUNDS_EPSILON
      ) throw new Error("Invalid recorded keyframe");
      previous = f.t;
    }
  }
  if (data.occluders !== undefined) {
    if (!Array.isArray(data.occluders)) throw new Error("Invalid recorded occluders");
    for (const m of data.occluders) {
      const ok = m && Number.isFinite(m.start) && Number.isFinite(m.end) && m.start >= 0 && m.end > m.start && m.end <= data.duration
        && (m.id === undefined || typeof m.id === "string")
        && (m.trackIds === undefined || (Array.isArray(m.trackIds) && m.trackIds.every((id) => typeof id === "string" && ids.has(id))))
        && Array.isArray(m.polygon) && m.polygon.length >= 3
        && m.polygon.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
      if (!ok) throw new Error("Invalid recorded occluder");
    }
  }
  return data;
}

/** Masks active at a time (inclusive window), sampled from the same video time as the heads. */
export function activeOcclusionMasks(data: RecordedTracking, time: number): OcclusionMask[] {
  return (data.occluders ?? []).filter((m) => time >= m.start && time <= m.end);
}

/**
 * Linear interpolation between neighbouring visible keyframes. Outside a
 * track's span, or across a gap that ends in an invisible keyframe, nothing is
 * drawn: a subject position is never extrapolated. Tracks without an explicit
 * entityKind are treated as people.
 */
export function sampleHeads(data: RecordedTracking, time: number): Head[] {
  if (!Number.isFinite(time) || time < 0 || time > data.duration) return [];
  const heads: Head[] = [];
  for (const { id, keyframes, entityKind } of data.tracks) {
    const kind = entityKind ?? "person";
    const style = kind === "person" ? markerStyleForTrack(id) : undefined;
    const first = keyframes[0]!;
    const last = keyframes[keyframes.length - 1]!;
    if (time < first.t || time > last.t) continue;
    let a = first;
    let b = first;
    for (const frame of keyframes) {
      if (frame.t <= time) a = frame;
      if (frame.t >= time) { b = frame; break; }
    }
    if (!a.visible) continue;
    if (b.t === a.t) { heads.push({ trackId: id, x: a.x, y: a.y, w: a.w, h: a.h, kind, style }); continue; }
    if (!b.visible) continue;
    const mix = (time - a.t) / (b.t - a.t);
    heads.push({
      trackId: id,
      x: a.x +(b.x - a.x) * mix,
      y: a.y + (b.y - a.y) * mix,
      w: a.w + (b.w - a.w) * mix,
      h: a.h + (b.h - a.h) * mix,
      kind,
      style,
    });
  }
  return heads;
}

const MARKER_LIGHT = "#f2f2ee";
const MARKER_OUTLINE = "rgba(20,20,20,0.7)";

export interface TriangleGeometry {
  apexX: number;
  apexY: number;
  left: number;
  right: number;
  baseY: number;
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Open-head marker layout in canvas pixels: a downward-pointing triangle sits
 * just above the head with its apex toward it, sized from the head box and kept
 * inside the frame. Pure so it can be tested without a canvas.
 */
export function headTriangle(width: number, height: number, head: Head): TriangleGeometry {
  const hx = head.x * width, hy = head.y * height, hw = head.w * width, hh = head.h * height;
  const pad = Math.max(1.5, Math.max(hw, hh) * 0.18);
  const box = { x: hx - pad, y: hy - pad, w: hw + pad * 2, h: hh + pad * 2 };
  const base = Math.min(Math.max(hw * 1.1, 9), 40);
  const rise = base * 0.8;
  const gap = Math.max(1.5, hh * 0.1);
  // Prefer above the head; with no room the triangle stays in frame, overlapping the head box.
  const apexY = Math.max(box.y - gap, rise + 1);
  const cx = Math.min(Math.max(hx + hw / 2, base / 2 + 1), width - base / 2 - 1);
  return { apexX: cx, apexY, left: cx - base / 2, right: cx + base / 2, baseY: apexY - rise, box };
}

function strokeTwice(ctx: CanvasRenderingContext2D, trace: () => void, lineWidth: number) {
  ctx.lineJoin = "miter";
  ctx.strokeStyle = MARKER_OUTLINE;
  ctx.lineWidth = lineWidth + 2;
  trace();
  ctx.stroke();
  ctx.strokeStyle = MARKER_LIGHT;
  ctx.lineWidth = lineWidth;
  trace();
  ctx.stroke();
}

/** Neutral head marker: open (unfilled) triangle plus minimal corner ticks, light stroke over a dark outline. */
export function drawHeadMarker(ctx: CanvasRenderingContext2D, width: number, height: number, head: Head): void {
  const g = headTriangle(width, height, head);
  const tick = Math.max(2, Math.min(g.box.w, g.box.h) * 0.3);
  ctx.save();
  ctx.setLineDash([]);
  strokeTwice(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(g.left, g.baseY);
    ctx.lineTo(g.right, g.baseY);
    ctx.lineTo(g.apexX, g.apexY);
    ctx.closePath();
  }, 1.4);
  strokeTwice(ctx, () => {
    const { x, y, w, h } = g.box;
    ctx.beginPath();
    for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
      ctx.moveTo(px + sx * tick, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * tick);
    }
  }, 1.2);
  ctx.restore();
}

/**
 * Circular head frame: thin pale outer circle, subtle inner ring, side arcs and
 * the usual head corner frame; optionally a red outlined downward triangle.
 * Original canvas primitives; ring is capped in size and kept inside the canvas.
 */
export function drawCircleMarker(ctx: CanvasRenderingContext2D, width: number, height: number, head: Head, redTriangle: boolean): void {
  const hx = head.x * width, hy = head.y * height, hw = head.w * width, hh = head.h * height;
  const r = Math.min(Math.max(Math.max(hw, hh) * 0.85, 9), 34, width / 2 - 6, height / 2 - 6);
  const cx = Math.min(Math.max(hx + hw / 2, r + 4), width - r - 4);
  const cy = Math.min(Math.max(hy + hh / 2, r + 4), height - r - 4);
  const pad = Math.max(1.5, Math.max(hw, hh) * 0.18);
  const bx = hx - pad, by = hy - pad, bw = hw + pad * 2, bh = hh + pad * 2;
  const tick = Math.max(2, Math.min(bw, bh) * 0.3);
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  strokeTwice(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); }, 1);
  ctx.globalAlpha = 0.55;
  strokeTwice(ctx, () => { ctx.beginPath(); ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2); }, 0.8);
  ctx.globalAlpha = 1;
  const ro = r + Math.min(3.5, Math.max(2, r * 0.14)), span = 0.38;
  strokeTwice(ctx, () => {
    ctx.beginPath();
    ctx.arc(cx, cy, ro, -span, span);
    ctx.moveTo(cx + Math.cos(Math.PI - span) * ro, cy + Math.sin(Math.PI - span) * ro);
    ctx.arc(cx, cy, ro, Math.PI - span, Math.PI + span);
  }, 1.4);
  strokeTwice(ctx, () => {
    ctx.beginPath();
    for (const [px, py, sx, sy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]] as const) {
      ctx.moveTo(px + sx * tick, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * tick);
    }
  }, 1.1);
  if (redTriangle) {
    const tr = r * 0.68;
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(cx - tr * 0.866, cy - tr * 0.5);
      ctx.lineTo(cx + tr * 0.866, cy - tr * 0.5);
      ctx.lineTo(cx, cy + tr);
      ctx.closePath();
    };
    ctx.lineJoin = "miter";
    ctx.strokeStyle = MARKER_OUTLINE;
    ctx.lineWidth = 3.2;
    trace();
    ctx.stroke();
    ctx.strokeStyle = "#d8161b";
    ctx.lineWidth = 1.6;
    trace();
    ctx.stroke();
  }
  ctx.restore();
}

/** Neutral object marker for vehicles: a plain rectangle outline, never a head triangle. */
export function drawObjectOutline(ctx: CanvasRenderingContext2D, width: number, height: number, entity: Head): void {
  ctx.save();
  ctx.setLineDash([]);
  strokeTwice(ctx, () => {
    ctx.beginPath();
    ctx.rect(entity.x * width, entity.y * height, entity.w * width, entity.h * height);
  }, 1.4);
  ctx.restore();
}

export function drawMarker(ctx: CanvasRenderingContext2D, width: number, height: number, entity: Head, masks: readonly OcclusionMask[] = []): void {
  const scoped = masks.filter((m) => !m.trackIds || (entity.trackId !== undefined && m.trackIds.includes(entity.trackId)));
  if (scoped.length === 0) { drawMarkerShape(ctx, width, height, entity); return; }
  // Marker only: each mask clips to the outside of its polygon (evenodd). Video is already painted.
  ctx.save();
  for (const m of scoped) {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    m.polygon.forEach(([px, py], i) => (i ? ctx.lineTo(px * width, py * height) : ctx.moveTo(px * width, py * height)));
    ctx.closePath();
    ctx.clip("evenodd");
  }
  drawMarkerShape(ctx, width, height, entity);
  ctx.restore();
}

function drawMarkerShape(ctx: CanvasRenderingContext2D, width: number, height: number, entity: Head): void {
  if (entity.kind === "vehicle") drawObjectOutline(ctx, width, height, entity);
  else if (entity.style === "circle-frame") drawCircleMarker(ctx, width, height, entity, false);
  else if (entity.style === "circle-red-triangle") drawCircleMarker(ctx, width, height, entity, true);
  else drawHeadMarker(ctx, width, height, entity);
}
