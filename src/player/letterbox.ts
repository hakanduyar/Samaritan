export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Largest integer-pixel rect of `aspect` (width / height) centred inside the
 * container. Bars fill the remainder; the comparison camera is never cropped.
 */
export function letterbox(containerWidth: number, containerHeight: number, aspect: number): Rect {
  const cw = Math.max(0, Math.floor(containerWidth));
  const ch = Math.max(0, Math.floor(containerHeight));
  if (cw === 0 || ch === 0 || !(aspect > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  let width: number;
  let height: number;
  if (cw / ch > aspect) {
    height = ch;
    width = Math.min(cw, Math.round(ch * aspect));
  } else {
    width = cw;
    height = Math.min(ch, Math.round(cw / aspect));
  }
  return { x: Math.floor((cw - width) / 2), y: Math.floor((ch - height) / 2), width, height };
}
