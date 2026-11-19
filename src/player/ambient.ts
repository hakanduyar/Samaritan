import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, PropertyBinding, Vector2, Vector3, type AnimationClip, type Camera, type Object3D, type PerspectiveCamera } from "three";

export const MAX_AMBIENT_RAILS = 144;
const MAX_REEL_RAILS = 48;
const STATIC_RAIL_NAME = /^(strip_\d+_b[2-5]|journey_depth_\d+)$/;

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

// Horizontal ticks and short side markings can inflate the mesh's bounds.
// Only tall, narrow triangles contribute to the rail's usable travel.
function spineBounds(mesh: Mesh): [number, number] {
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(i + corner) : i + corner;
      xMin = Math.min(xMin, positions.getX(vertex)); xMax = Math.max(xMax, positions.getX(vertex));
      yMin = Math.min(yMin, positions.getY(vertex)); yMax = Math.max(yMax, positions.getY(vertex));
    }
    if (xMax - xMin > 0.015 || yMax - yMin < 0.04 || yMax - yMin < 8 * (xMax - xMin)) continue;
    min = Math.min(min, yMin); max = Math.max(max, yMax);
  }
  return [min, max];
}

function smooth(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }

// Index programs: [cycle fraction at which a step starts, detent level].
// Levels are fractions of the supported travel (+ toward `high`, - toward
// `low`). Each program loops: the last level is the one held when the cycle
// begins. Steps are grouped into short bursts separated by long dwells.
const PROGRAMS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, -0.8], [0.045, -0.2], [0.09, 0.45], [0.135, 1], [0.57, 0.35], [0.615, -0.35]],
  [[0, 0.8], [0.05, 0.15], [0.1, -0.65], [0.48, -0.15], [0.53, 0.55], [0.58, -0.4]],
  [[0, -0.6], [0.045, 0], [0.09, 0.6], [0.135, -0.25], [0.18, 0.9], [0.67, 0.25]],
  [[0, 0.65], [0.06, -0.15], [0.12, -0.8], [0.6, -0.25], [0.66, 0.4]],
];
// After a reset each rail indexes from base onto its current detent, one rail
// after another, instead of every rail leaving base in the same frame.
const HOME_STAGGER_SECONDS = 0.05, HOME_SECONDS = 0.7;

function createReel(mesh: Mesh, fast: boolean, phase: number, period: number, direction: number) {
  const source = mesh.geometry, originalMaterial = mesh.material;
  const position = source.getAttribute("position"), index = source.getIndex();
  // These native strips are disconnected indexed quads. Reject a
  // different topology instead of wrapping vertices across a cell boundary.
  const cellCount = position.count / 4;
  if (Array.isArray(originalMaterial) || cellCount < 2 || cellCount > 24 || !Number.isInteger(cellCount) || index?.count !== cellCount * 6) return null;
  const centres = new Float32Array(position.count);
  for (let quad = 0; quad < cellCount; quad++) {
    const vertices = new Set(Array.from({ length: 6 }, (_, i) => index.getX(quad * 6 + i)));
    if (vertices.size !== 4 || [...vertices].some((vertex) => vertex < quad * 4 || vertex >= quad * 4 + 4)) return null;
    const centre = [...vertices].reduce((sum, vertex) => sum + position.getY(vertex), 0) / 4;
    for (const vertex of vertices) centres[vertex] = centre;
  }
  const [low, high] = yBounds(mesh), span = high - low;
  if (span <= 0) return null;
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = new Float32Array(attribute.count * attribute.itemSize * 3);
    for (let copy = 0; copy < 3; copy++) for (let vertex = 0; vertex < attribute.count; vertex++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values[(copy * attribute.count + vertex) * attribute.itemSize + component] = attribute.getComponent(vertex, component);
      }
    }
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
  }
  geometry.setIndex(Array.from({ length: index.count * 3 }, (_, i) => index.getX(i % index.count) + Math.floor(i / index.count) * position.count));
  geometry.setAttribute("ambientCellCentre", new Float32BufferAttribute([...centres, ...centres, ...centres], 1));
  geometry.setAttribute("ambientReelCopy", new Float32BufferAttribute([
    ...new Array(position.count).fill(-1), ...new Array(position.count).fill(0), ...new Array(position.count).fill(1),
  ], 1));
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  const material = originalMaterial.clone();
  const travel = { value: 0 };
  const window = { value: new Vector2(low, high) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ambientReelTravel = travel;
    shader.uniforms.ambientReelWindow = window;
    shader.vertexShader = `attribute float ambientCellCentre;
      attribute float ambientReelCopy;
      uniform float ambientReelTravel;
      uniform vec2 ambientReelWindow;
      varying float ambientReelY;
      ${shader.vertexShader}`.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      float reelSpan = ambientReelWindow.y - ambientReelWindow.x;
      float wrappedCentre = ambientReelWindow.x + mod(ambientCellCentre - ambientReelTravel - ambientReelWindow.x, reelSpan);
      transformed.y += wrappedCentre - ambientCellCentre + ambientReelCopy * reelSpan;
      ambientReelY = transformed.y;
    `);
    shader.fragmentShader = `uniform vec2 ambientReelWindow;
      varying float ambientReelY;
      ${shader.fragmentShader}`.replace("#include <alphamap_fragment>", `
      #include <alphamap_fragment>
      if (ambientReelY < ambientReelWindow.x || ambientReelY > ambientReelWindow.y) discard;
    `);
  };
  material.customProgramCacheKey = () => "ambient-native-cell-reel-v1";
  return {
    apply(seconds: number) {
      mesh.geometry = geometry; mesh.material = material;
      seconds += phase * period;
      const local = seconds % period;
      const cells = fast ? 11 * (Math.floor(seconds / period) + smooth(Math.min(1, local / (period * .41)))) : seconds * cellCount / period;
      travel.value = direction * (cells % cellCount) * span / cellCount;
    },
    reset() { mesh.geometry = source; mesh.material = originalMaterial; travel.value = 0; },
    dispose() { this.reset(); geometry.dispose(); material.dispose(); },
  };
}

// A small subset of the existing rails is re-anchored in world space around the
// active camera. `anchor` is the rail node's world position; `cellOffset` is the
// visible cell centre relative to it (the pivot is not where the cells are) and
// `corners` are the rail's actual world-axis bounds relative to the anchor.
type Recycler = {
  anchor: Vector3; home: Vector3; cellOffset: Vector3; corners: Vector3[]; halfH: number;
  slot: number; spawns: number;
};
const FOCUS_X = 0.5, FOCUS_Y = 0.5, KEEP_NDC = 1.35;
const SEED_HEIGHTS = [0.5, 0.34, 0.42, 0.28, 0.46];
const bounds = { front: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
const probe = new Vector3();

// Project the rail's real bounds (not just its pivot) with the camera's view
// matrix and projection; corners at or behind the near plane count as not-front.
function measure(camera: PerspectiveCamera, view: Matrix4, r: Recycler) {
  const e = camera.projectionMatrix.elements;
  bounds.front = 0; bounds.minX = bounds.minY = Infinity; bounds.maxX = bounds.maxY = -Infinity;
  for (const corner of r.corners) {
    probe.copy(r.anchor).add(corner).applyMatrix4(view);
    if (probe.z > -camera.near) continue;
    bounds.front++;
    const x = probe.x * e[0]! / -probe.z, y = probe.y * e[5]! / -probe.z;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  }
}
const clearOfFocus = () => bounds.minX > FOCUS_X || bounds.maxX < -FOCUS_X || bounds.minY > FOCUS_Y || bounds.maxY < -FOCUS_Y;

// Put the rail's cell centre at an outer normalized-view slot (left/right x~±.65,
// top/bottom y~±.6) at a depth chosen from its authored height, never inside the
// central focus rectangle. Scale is untouched. Returns false if no fit is found.
function place(camera: PerspectiveCamera, view: Matrix4, r: Recycler) {
  const e = camera.projectionMatrix.elements;
  const tanHalf = 1 / e[5]!, aspect = e[5]! / e[0]!;
  const kind = (r.slot + r.spawns) % 4;
  const u = ((r.slot * 0.37 + r.spawns * 0.61) % 1) * 1.2 - 0.6;
  const edge = 0.65 + ((r.slot * 0.13 + r.spawns * 0.29) % 1) * 0.1 - 0.05;
  let cx = kind === 0 ? -edge : kind === 1 ? edge : u;
  let cy = kind === 2 ? 0.6 : kind === 3 ? -0.6 : u;
  const target = r.spawns === 0 ? SEED_HEIGHTS[r.slot % SEED_HEIGHTS.length]! : 0.1 + (r.spawns % 3) * 0.03;
  let d = Math.min(camera.far * 0.6, Math.max(camera.near * 3, r.halfH / (0.5 * target * tanHalf)));
  for (let attempt = 0; attempt < 6; attempt++) {
    probe.set(cx * d * tanHalf * aspect, cy * d * tanHalf, -d).applyMatrix4(camera.matrixWorld);
    r.anchor.copy(probe).sub(r.cellOffset);
    measure(camera, view, r);
    if (bounds.front === 8 && clearOfFocus()) return true;
    d = Math.min(camera.far * 0.6, d * 1.25); cx *= 1.06; cy *= 1.06;
  }
  return false;
}

type Rail = {
  node: Object3D; basePosition: Vector3;
  name: string; mesh: Mesh; base: number; low: number; high: number; period: number;
  reverse: boolean; band: number; x: number; y: number; z: number; side: number; sector: number; depthBand: number; recycle: Recycler | null;
  program: ReadonlyArray<readonly [number, number]>; phase: number; delay: number; applied: number;
  continuous: boolean; stepSeconds: number; homeSeconds: number;
  mode: "stepped" | "sine" | "slow-reel" | "fast-reel";
  reel: ReturnType<typeof createReel>;
};

export function createAmbientRails(root: Object3D, clips: AnimationClip[], protectedNames: string[]) {
  const animated = clips.flatMap((clip) => clip.tracks.map((track) => PropertyBinding.parseTrackName(track.name).nodeName));
  const protectedNodes = [...protectedNames, ...animated].flatMap((name) => {
    const node = name ? root.getObjectByName(name) : undefined;
    return node ? [node] : [];
  });
  const candidates: Rail[] = [];
  const world = new Vector3();
  root.traverse((rail) => {
    const name = rail.name;
    if (!STATIC_RAIL_NAME.test(name) || protectedNodes.some((node) => related(rail, node))) return;
    let line: Mesh | undefined, cell: Mesh | undefined;
    rail.traverse((node) => {
      if (!(node instanceof Mesh) || Array.isArray(node.material)) return;
      // glTF multi-primitive children are identity-local. Reject unexpected
      // transforms rather than guessing a shared rail coordinate system.
      if (node !== rail && (node.position.lengthSq() !== 0 || node.quaternion.w !== 1 || node.scale.x !== 1 || node.scale.y !== 1 || node.scale.z !== 1)) return;
      if (/^mat_field_line_b[2-5]$/.test(node.material.name)) line = node;
      if (/^mat_field_cell_b[2-5]$/.test(node.material.name)) cell = node;
    });
    if (!line || !cell || line === cell) return;
    const [railMin, railMax] = spineBounds(line), [cellMin, cellMax] = yBounds(cell);
    const limit = 0.45;
    const low = Math.max(-limit, railMin - cellMin + 0.01);
    const high = Math.min(limit, railMax - cellMax - 0.01);
    if (low > -0.08 || high < 0.08) return;
    // Use the visible cell geometry's world-space centre, not the rail pivot.
    cell.updateWorldMatrix(true, false);
    if (!cell.geometry.boundingBox) cell.geometry.computeBoundingBox();
    cell.geometry.boundingBox!.getCenter(world).applyMatrix4(cell.matrixWorld);
    candidates.push({
      node: rail, basePosition: rail.position.clone(),
      name, mesh: cell, base: cell.position.y, low, high, period: 0, reverse: candidates.length % 2 === 1,
      band: !Array.isArray(cell.material) ? Number(/_b([2-5])$/.exec(cell.material.name)![1]) - 2 : 0, x: world.x, y: world.y, z: world.z, side: 0, sector: 0, depthBand: 0, recycle: null,
      program: PROGRAMS[0]!, phase: 0, delay: 0, applied: 0,
      continuous: false, stepSeconds: 0.16, homeSeconds: HOME_SECONDS,
      mode: "stepped", reel: null,
    });
  });
  candidates.sort((a, b) => a.z - b.z || a.x - b.x || a.name.localeCompare(b.name));
  const count = Math.min(MAX_AMBIENT_RAILS, candidates.length);
  // Spatially stratify BEFORE selection. x/y/z are the world centres of the
  // visible cell geometry; sector edges are tertiles of the candidate field
  // itself, so they follow the route rather than any global origin.
  const tertiles = (values: number[]): [number, number] => {
    const sorted = [...values].sort((a, b) => a - b);
    return [sorted[Math.floor(sorted.length / 3)] ?? 0, sorted[Math.floor(sorted.length * 2 / 3)] ?? 0];
  };
  const tier = (v: number, [a, b]: [number, number]) => (v < a ? 0 : v < b ? 1 : 2);
  const xEdges = tertiles(candidates.map((item) => item.x));
  const yEdges = tertiles(candidates.map((item) => item.y));
  const zEdges = tertiles(candidates.map((item) => item.z));
  const cellGroups = Array.from({ length: 27 }, () => [] as Rail[]);
  for (const item of candidates) {
    item.sector = tier(item.y, yEdges) * 3 + tier(item.x, xEdges); // down/mid/up x left/mid/right
    item.depthBand = 2 - tier(item.z, zEdges); // 0 near, 1 mid, 2 far
    cellGroups[item.depthBand * 9 + item.sector]!.push(item);
  }
  // Credit-based quotas: near/mid cells earn more picks than far cells, but
  // every non-empty cell keeps representation. Total stays at `count`.
  const depthWeight = [1.4, 1.2, 0.8];
  const quota = cellGroups.map(() => 0), credit = cellGroups.map(() => 0);
  for (let total = 0, guard = 0; total < count && guard < 1000; guard++) {
    for (const [cell, group] of cellGroups.entries()) {
      if (total >= count) break;
      credit[cell]! += depthWeight[Math.floor(cell / 9)]!;
      while (credit[cell]! >= 1 && quota[cell]! < group.length && total < count) { credit[cell]!--; quota[cell]!++; total++; }
      if (quota[cell]! >= group.length) credit[cell] = 0;
    }
  }
  // Even stride along z within each cell keeps near-to-far coverage there.
  const selected = cellGroups.flatMap((group, cell) =>
    Array.from({ length: quota[cell]! }, (_, i) => group[Math.floor((i + 0.5) * group.length / quota[cell]!)]!));
  selected.sort((a, b) => a.z - b.z || a.x - b.x || a.name.localeCompare(b.name));
  // Spread activity over depth bands and sides: bucket the rails by band and
  // by side of the median x, order each bucket along z, then deal the buckets
  // round-robin. Consecutive rails in that order sit in different buckets and
  // get evenly spaced cycle phases, staggered homing and different programs.
  const xs = selected.map((item) => item.x).sort((a, b) => a - b);
  const medianX = xs.length ? (xs[(xs.length - 1) >> 1]! + xs[xs.length >> 1]!) / 2 : 0;
  for (const item of selected) item.side = item.x > medianX ? 1 : 0;
  const buckets = Array.from({ length: 8 }, (_, key) => selected
    .filter((item) => item.band * 2 + item.side === key)
    .sort((a, b) => a.z - b.z || a.name.localeCompare(b.name)));
  for (let order = 0, row = 0; order < selected.length; row++) {
    for (const bucket of buckets) {
      const item = bucket[row];
      if (!item) continue;
      item.program = PROGRAMS[order % PROGRAMS.length]!;
      item.phase = order / selected.length;
      item.delay = (order % 17) * HOME_STAGGER_SECONDS;
      // Each depth/side bucket alternates indexing and slow travel. Longer
      // deep cycles and incommensurate periods prevent a shared pulse.
      item.continuous = row % 3 === (item.side + item.band) % 3;
      item.period = item.continuous
        ? 12.7 + item.band * 2.1 + (order % 7) * 1.37
        : 5.8 + item.band * 0.65 + (order % 7) * 0.43;
      item.stepSeconds = 0.1 + (order % 4) * 0.04;
      item.homeSeconds = HOME_SECONDS + item.band * 0.25;
      order++;
    }
  }
  for (const item of selected) item.mode = item.continuous ? "sine" : "stepped";
  const reelCandidates = selected.filter(({mesh})=>{
    const cells = mesh.geometry.getAttribute("position").count / 4;
    return Number.isInteger(cells) && cells >= 2 && cells <= 24 && mesh.geometry.getIndex()?.count === cells * 6;
  });
  const reelCount = Math.min(MAX_REEL_RAILS, Math.floor(selected.length * 0.6), reelCandidates.length);
  // Deal the reel budget over the same 3 depth x 9 sector buckets used for
  // selection (near-first). Row 0 visits every bucket, later rows skip far
  // buckets, and the sector order rotates per row so no sector is favoured.
  const reelBuckets = Array.from({ length: 27 }, () => [] as Rail[]);
  for (const item of reelCandidates) reelBuckets[item.depthBand * 9 + item.sector]!.push(item);
  for (const bucket of reelBuckets) bucket.sort((a,b)=>b.z-a.z);
  let assigned = 0;
  // Pass 0 favours near/mid after row 0; pass 1 tops up from far buckets so
  // the reel budget is never left underfilled (cap unchanged).
  for (const allowFar of [false, true]) for (let row = 0; assigned < reelCount && row < reelCandidates.length; row++) {
    for (let step = 0; step < 27; step++) {
      const depthBand = Math.floor(step / 9), sector = (step % 9 + row * 4) % 9;
      if (!allowFar && row > 0 && depthBand === 2) continue;
      const item = reelBuckets[depthBand * 9 + sector]![row];
      if (!item || item.reel || assigned >= reelCount) continue;
      const sx = sector % 3, sy = Math.floor(sector / 3);
      // Latin-style diagonal: every column, row and depth band gets both fast
      // and slow reels (about one in three fast).
      const fast = (sx + sy + depthBand + row) % 3 === 0;
      // Preserve the spatial buckets and budget, but prevent a common reel
      // clock or direction from making distant clusters move in lockstep.
      const period = fast ? 2.8 + (assigned % 7) * .23 : 7.4 + (assigned % 11) * .37;
      const phase = (item.phase + assigned * .381966) % 1;
      const direction = (sx * 2 + sy + depthBand + row) % 2 ? -1 : 1;
      const reel = createReel(item.mesh, fast, phase, period, direction);
      if (!reel) continue;
      item.reel = reel;
      item.mode = fast ? "fast-reel" : "slow-reel";
      assigned++;
    }
  }
  // Choose 10 of the existing selected rails (no new rails, same budgets):
  // 3 slow-reel, 2 fast-reel, 3 sine, 2 stepped, spread along z within each mode.
  const recyclers: Rail[] = [];
  for (const [mode, quotaCount] of [["slow-reel", 3], ["fast-reel", 2], ["sine", 3], ["stepped", 2]] as const) {
    const pool = selected.filter((item) => item.mode === mode).sort((a, b) => a.z - b.z);
    const n = Math.min(quotaCount, pool.length);
    for (let i = 0; i < n; i++) {
      const item = pool[Math.floor((i + 0.5) * pool.length / n)]!;
      item.node.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(item.node);
      const pivot = item.node.getWorldPosition(new Vector3());
      const halfH = (box.max.y - box.min.y) / 2;
      if (box.isEmpty() || !(halfH > 0.05) || !Number.isFinite(halfH)) continue;
      item.recycle = {
        anchor: pivot.clone(), home: pivot.clone(),
        cellOffset: new Vector3(item.x, item.y, item.z).sub(pivot),
        corners: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new Vector3(
          k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).sub(pivot)),
        halfH, slot: recyclers.length, spawns: 0,
      };
      recyclers.push(item);
    }
  }
  let elapsed = 0;
  let disposed = false;
  const cameraPosition = new Vector3(), baseWorld = new Vector3(), approach = new Vector3();
  const shifted = new Vector3(), previous = new Vector3(), viewMatrix = new Matrix4();
  const relocate = (item: Rail, camera: PerspectiveCamera) => {
    const r = item.recycle!;
    measure(camera, viewMatrix, r);
    const unseeded = r.spawns === 0;
    // Recycle only when the entire rail is behind the camera or wholly outside
    // an expanded frustum, so the move itself is never visible.
    const gone = bounds.front === 0 || (bounds.front === 8 &&
      (bounds.minX > KEEP_NDC || bounds.maxX < -KEEP_NDC || bounds.minY > KEEP_NDC || bounds.maxY < -KEEP_NDC));
    if (!unseeded && !gone) return;
    previous.copy(r.anchor);
    if (!place(camera, viewMatrix, r)) { r.anchor.copy(previous); return; }
    r.spawns++;
    if (item.node.parent) {
      item.node.position.copy(item.node.parent.worldToLocal(shifted.copy(r.anchor)));
      item.node.updateMatrixWorld(true);
    }
  };
  return {
    selection: selected.map(({ name, low, high, period, continuous, stepSeconds, mode }) => ({ name, low, high, period, continuous, stepSeconds, mode })),
    advance(visibleSeconds: number) { if (!disposed) elapsed += Math.max(0, visibleSeconds); },
    apply(camera?: Camera) {
      if (disposed) return;
      if (camera) camera.getWorldPosition(cameraPosition);
      const perspective = camera && (camera as PerspectiveCamera).isPerspectiveCamera ? camera as PerspectiveCamera : null;
      if (perspective) { perspective.updateMatrixWorld(); viewMatrix.copy(perspective.matrixWorld).invert(); }
      for (const item of selected) {
        if (item.recycle && perspective) relocate(item, perspective);
        // Move a complete multi-pane rail, including its spine. Each cluster
        // approaches and recedes on its own clock, with alternating lateral
        // directions. Fade travel out before it reaches the camera corridor.
        if (item.reel && camera && item.node.parent) {
          // Recycled rails wiggle around their world anchor, not the authored base.
          if (item.recycle) baseWorld.copy(item.recycle.anchor);
          else baseWorld.copy(item.basePosition).applyMatrix4(item.node.parent.matrixWorld);
          approach.subVectors(cameraPosition, baseWorld);
          const distance = approach.length();
          const clearance = smooth(Math.min(1, Math.max(0, (distance - 12) / 8)));
          const home = smooth(Math.min(1, elapsed / 1.5));
          const angle = elapsed / (9.3 + item.phase * 7.7) * Math.PI * 2 + item.phase * Math.PI * 2;
          const depth = (Math.sin(angle) - Math.sin(item.phase * Math.PI * 2)) * .9 * clearance * home;
          const lateral = (Math.cos(angle * .79 + item.phase * 5) - Math.cos(item.phase * 5))
            * .24 * (item.reverse ? -1 : 1) * clearance * home;
          shifted.copy(baseWorld).addScaledVector(approach.normalize(), depth);
          shifted.x += lateral;
          item.node.position.copy(item.node.parent.worldToLocal(shifted));
          item.node.updateMatrixWorld(true);
        }
        if (item.reel) { item.reel.apply(elapsed); continue; }
        const program = item.program, cycle = (elapsed / item.period + item.phase) % 1;
        let motion: number;
        if (item.continuous) {
          motion = Math.sin(cycle * Math.PI * 2) * 0.78;
        } else {
          let k = program.length - 1;
          while (k > 0 && program[k]![0] > cycle) k--;
          const from = program[k === 0 ? program.length - 1 : k - 1]![1], to = program[k]![1];
          const u = Math.min(1, (cycle - program[k]![0]) * item.period / item.stepSeconds);
          motion = from + (to - from) * smooth(u);
        }
        const home = Math.min(1, Math.max(0, (elapsed - item.delay) / item.homeSeconds));
        const level = motion * smooth(home) * (item.reverse ? -1 : 1);
        const offset = Math.min(item.high, Math.max(item.low, level >= 0 ? level * item.high : -level * item.low));
        // Dwelling rails keep their matrices; only a cell that actually moved
        // refreshes its own subtree.
        if (offset === item.applied) continue;
        item.applied = offset;
        item.mesh.position.y = item.base + offset;
        item.mesh.updateMatrixWorld(true);
      }
    },
    reset() {
      elapsed = 0;
      for (const item of selected) { item.reel?.reset(); item.applied = 0; item.mesh.position.y = item.base; item.node.position.copy(item.basePosition); if (item.recycle) { item.recycle.anchor.copy(item.recycle.home); item.recycle.spawns = 0; } }
      root.updateMatrixWorld(true);
    },
    dispose() {
      if (disposed) return;
      this.reset();
      disposed = true;
      for (const item of selected) item.reel?.dispose();
    },
  };
}
