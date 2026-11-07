import { Mesh, PropertyBinding, type AnimationClip, type Object3D } from "three";

// Inspected static rail/cell pairs in the bundled world. No near
// shutter layer, focus surface, focus parent, or arbitrary mesh is selected.
export const AMBIENT_RAILS = [
  "strip_044_b2", "strip_072_b2", "strip_088_b2", "strip_113_b2",
  "strip_141_b2", "strip_065_b3", "strip_085_b3", "strip_118_b3",
  "strip_030_b2", "strip_064_b2", "strip_096_b2", "strip_039_b3",
  "strip_101_b3", "strip_142_b3",
] as const;

// The six appended pairs have verified continuous support over ±0.25 only.
// Decorative ticks can extend indexed bounds without extending that support.
const EXTENDED_RAILS = new Set<string>(AMBIENT_RAILS.slice(8));

function related(a: Object3D, b: Object3D) {
  for (let p: Object3D | null = a; p; p = p.parent) if (p === b) return true;
  for (let p: Object3D | null = b; p; p = p.parent) if (p === a) return true;
  return false;
}

function yBounds(mesh: Mesh): [number, number] {
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < (index?.count ?? positions.count); i++) {
    const y = positions.getY(index ? index.getX(i) : i);
    min = Math.min(min, y); max = Math.max(max, y);
  }
  return [min, max];
}

function smooth(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }

export function createAmbientRails(root: Object3D, clips: AnimationClip[], protectedNames: string[]) {
  const animated = clips.flatMap((clip) => clip.tracks.map((track) => PropertyBinding.parseTrackName(track.name).nodeName));
  const protectedNodes = [...protectedNames, ...animated].flatMap((name) => {
    const node = name ? root.getObjectByName(name) : undefined;
    return node ? [node] : [];
  });
  const selected: Array<{ name: string; mesh: Mesh; base: number; low: number; high: number; period: number; delay: number; reverse: boolean }> = [];
  for (const [i, name] of AMBIENT_RAILS.entries()) {
    const rail = root.getObjectByName(name);
    if (!rail || protectedNodes.some((node) => related(rail, node))) continue;
    let line: Mesh | undefined, cell: Mesh | undefined;
    rail.traverse((node) => {
      if (!(node instanceof Mesh) || Array.isArray(node.material)) return;
      // glTF multi-primitive children are identity-local. Reject unexpected
      // transforms rather than guessing a shared rail coordinate system.
      if (node !== rail && (node.position.lengthSq() !== 0 || node.quaternion.w !== 1 || node.scale.x !== 1 || node.scale.y !== 1 || node.scale.z !== 1)) return;
      if (/^mat_field_line_b[23]$/.test(node.material.name)) line = node;
      if (/^mat_field_cell_b[23]$/.test(node.material.name)) cell = node;
    });
    if (!line || !cell || line === cell) continue;
    const [railMin, railMax] = yBounds(line), [cellMin, cellMax] = yBounds(cell);
    const limit = EXTENDED_RAILS.has(name) ? 0.25 : 0.45;
    const low = Math.max(-limit, railMin - cellMin + 0.01);
    const high = Math.min(limit, railMax - cellMax - 0.01);
    if (low >= 0 || high <= 0) continue;
    selected.push({ name, mesh: cell, base: cell.position.y, low, high, period: 10 + (i % 4) * 2, delay: i * 0.17, reverse: i % 2 === 1 });
  }
  let elapsed = 0;
  return {
    selection: selected.map(({ name, low, high, period }) => ({ name, low, high, period })),
    advance(visibleSeconds: number) { elapsed += Math.max(0, visibleSeconds); },
    apply() {
      for (const item of selected) {
        const t = Math.max(0, elapsed - item.delay);
        const phase = (t / item.period * 4 + (item.reverse ? 2 : 0)) % 4;
        const k = Math.floor(phase), u = smooth(phase - k);
        const points = [0, item.high, 0, item.low, 0];
        const offset = points[k]! + (points[k + 1]! - points[k]!) * u;
        item.mesh.position.y = item.base + offset;
      }
      root.updateMatrixWorld(true);
    },
    reset() { elapsed = 0; for (const item of selected) item.mesh.position.y = item.base; root.updateMatrixWorld(true); },
  };
}
