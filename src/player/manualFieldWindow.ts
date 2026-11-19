import {
  Box3, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, Object3D, PropertyBinding, Vector2, Vector3, Vector4,
  type AnimationClip, type Material, type PerspectiveCamera,
} from "three";

const FIELD_GROUP = /^(field_depth_b\d|journey_continuation$)/;
const FIELD_MATERIAL = /^mat_field_(cell|line)_/;
const SHUTTER_SOURCE = /^optic_shutter_(.+)_s\d+$/;
const END_GUARD = 1;

// Each recipe is a continuous volume of jittered world-space strata. Aperture
// is expressed as the distance where its spread reaches the full 16:9 lens.
// Let the panes reach full visibility at a smaller projected size, then fade
// them out before the corresponding world-space strata are recycled.
const VOLUMES = [
  {
    columns: 8, rows: 6, spacing: 4.6, aperture: 18.6, fadeFrom: 70, fadeTo: 160,
    minHeight: 0.50, maxHeight: 1.02, seed: 0x2b7191, order: -1,
    variants: ["late_mid_000", "late_mid_006", "late_mid_007", "late_mid_008",
      "late_mid_012", "late_mid_016", "late_mid_023", "late_mid_029"],
  },
  {
    columns: 11, rows: 8, spacing: 6.75, aperture: 34, fadeFrom: 100, fadeTo: 230,
    minHeight: 0.61, maxHeight: 1.75, seed: 0x7c0528, order: -2,
    variants: ["late_mid_003", "late_mid_013", "late_mid_019", "late_mid_027",
      "late_fine_C_000", "late_fine_C_001", "late_fine_C_005", "late_fine_D_004"],
  },
  {
    columns: 13, rows: 10, spacing: 12, aperture: 54, fadeFrom: 150, fadeTo: 330,
    minHeight: 0.95, maxHeight: 2.45, seed: 0x5c0dc3, order: -3,
    variants: ["late_fine_C_002", "late_fine_C_003", "late_fine_C_006", "late_fine_C_008",
      "late_fine_C_014", "late_fine_D_001", "late_fine_D_008", "strip_037_b4"],
  },
] as const;

interface FieldOptions {
  camera: PerspectiveCamera;
  clips: readonly AnimationClip[];
  protectedNames: readonly string[];
  focusNames: readonly string[];
  centreThinning?: number;
}

interface FieldNode {
  node: Object3D;
  parent: Object3D;
  index: number;
  meshes: Mesh[];
}

function isRelated(a: Object3D, b: Object3D) {
  for (let p: Object3D | null = a; p; p = p.parent) if (p === b) return true;
  for (let p: Object3D | null = b; p; p = p.parent) if (p === a) return true;
  return false;
}

function collectStaticField(root: Object3D, options: FieldOptions) {
  const protectedNodes = new Set<Object3D>();
  const protect = (name: string) => {
    const node = PropertyBinding.findNode(root, name);
    if (node instanceof Object3D) protectedNodes.add(node);
  };
  for (const name of options.protectedNames) protect(name);
  for (const clip of options.clips) for (const track of clip.tracks) {
    const { nodeName } = PropertyBinding.parseTrackName(track.name);
    if (nodeName) protect(nodeName);
  }

  const groups: Object3D[] = [];
  root.traverse((node) => {
    if (FIELD_GROUP.test(node.name)) groups.push(node);
    // The camera-relative shutter has a separate blurred copy of these strips.
    const sourceName = SHUTTER_SOURCE.exec(node.name)?.[1];
    if (sourceName) protect(sourceName);
  });

  const protectedList = Array.from(protectedNodes);
  const field: FieldNode[] = [];
  for (const parent of groups) for (const [index, node] of parent.children.entries()) {
    if (protectedList.some((protectedNode) => isRelated(node, protectedNode))) continue;
    const meshes: Mesh[] = [];
    node.traverse((child) => { if (child instanceof Mesh) meshes.push(child); });
    if (meshes.length && meshes.every(({ material }) => !Array.isArray(material) && FIELD_MATERIAL.test(material.name))) {
      field.push({ node, parent, index, meshes });
    }
  }
  return field;
}

function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothStep(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

export function createManualFieldWindow(root: Object3D, options: FieldOptions) {
  const { camera } = options;
  const originalFar = camera.far;
  const staticField = collectStaticField(root, options);
  const byName = new Map(staticField.map((entry) => [entry.node.name, entry]));
  const focusMeshes = new Set<Mesh>();
  for (const name of options.focusNames) root.getObjectByName(name)?.traverse((node) => {
    if (node instanceof Mesh) focusMeshes.add(node);
  });
  const focus = Array.from(focusMeshes, (mesh) => ({ mesh, bounds: new Vector4(), depthAndWeight: new Vector2() }));
  const focusBounds = { value: focus.map((pane) => pane.bounds) };
  const focusDepths = { value: focus.map((pane) => pane.depthAndWeight) };
  const focusCount = { value: 0 };
  const group = new Group();
  group.name = "manual_field_window";
  const materials: Material[] = [];
  const batches: InstancedMesh[] = [];
  let slotCount = 0;
  const tanY = Math.tan(camera.fov * Math.PI / 360);
  const tanX = tanY * camera.aspect;

  const instance = new Matrix4();
  const cameraWorld = new Vector3();
  camera.getWorldPosition(cameraWorld);
  const routeX = cameraWorld.x, routeY = cameraWorld.y;
  // Freeze the thinning corridor in world space along the authored itinerary.
  // Never base this on the live camera: revisiting a slab must reproduce it.
  const routeTrack = options.centreThinning === undefined ? undefined
    : options.clips.flatMap(clip => clip.tracks).find(track => track.name === 'route_camera.position');
  const routePoints: Vector3[] = [];
  if (routeTrack) for (let i = 0; i < routeTrack.values.length; i += 3) {
    const point = new Vector3(routeTrack.values[i], routeTrack.values[i + 1], routeTrack.values[i + 2]);
    if (camera.parent) point.applyMatrix4(camera.parent.matrixWorld);
    routePoints.push(point);
  }
  routePoints.sort((a,b) => a.z - b.z);
  const corridorAt = (z: number) => {
    if (!routePoints.length) return { x: routeX, y: routeY };
    let lo = 0, hi = routePoints.length - 1;
    if (z <= routePoints[lo]!.z) return routePoints[lo]!;
    if (z >= routePoints[hi]!.z) return routePoints[hi]!;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (routePoints[mid]!.z <= z) lo = mid; else hi = mid; }
    const a = routePoints[lo]!, b = routePoints[hi]!;
    const t = (z - a.z) / (b.z - a.z || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const volumes = VOLUMES.flatMap((recipe) => {
    const sources = recipe.variants.flatMap((name) => {
      const source = byName.get(name);
      return source ? [source] : [];
    });
    if (!sources.length) return [];

    const fade = { value: new Vector2(recipe.fadeFrom, recipe.fadeTo) };
    const volumeMaterials = new Map<Material, Material>();
    const batchMaterial = (original: Material) => {
      const cached = volumeMaterials.get(original);
      if (cached) return cached;
      const material = original.clone();
      material.forceSinglePass = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.manualFieldFade = fade;
        shader.uniforms.manualFocusBounds = focusBounds;
        shader.uniforms.manualFocusDepths = focusDepths;
        shader.uniforms.manualFocusCount = focusCount;
        shader.vertexShader = `varying vec3 manualFieldProjection;
          ${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          manualFieldProjection = vec3(gl_Position.xy, gl_Position.w);
          `,
        );
        const paneUniforms = focus.length ? `
          uniform vec4 manualFocusBounds[${focus.length}];
          uniform vec2 manualFocusDepths[${focus.length}];
          uniform int manualFocusCount;
        ` : "";
        const clearance = focus.length ? `
          vec2 fieldNdc = manualFieldProjection.xy / fieldDepth;
          for (int i = 0; i < ${focus.length}; i++) {
            if (i >= manualFocusCount) break;
            vec4 pane = manualFocusBounds[i];
            vec2 edge = min(fieldNdc - pane.xy, pane.zw - fieldNdc);
            float covered = smoothstep(-0.018, 0.006, min(edge.x, edge.y));
            vec2 depthAndWeight = manualFocusDepths[i];
            float inFront = 1.0 - smoothstep(depthAndWeight.x - 0.02, depthAndWeight.x + 0.03, fieldDepth);
            diffuseColor.a *= 1.0 - covered * inFront * depthAndWeight.y;
          }
        ` : "";
        shader.fragmentShader = `varying vec3 manualFieldProjection;
          uniform vec2 manualFieldFade;
          ${paneUniforms}
          ${shader.fragmentShader}`.replace("#include <alphamap_fragment>", `
          #include <alphamap_fragment>
          float fieldDepth = manualFieldProjection.z;
          if (fieldDepth >= manualFieldFade.y) discard;
          // Thin distant panes use low authored opacity. Recover some of their
          // contrast while keeping transparent texels and the near look intact.
          float contrast = 0.65 * smoothstep(0.5 * manualFieldFade.x, manualFieldFade.x, fieldDepth);
          diffuseColor.a += diffuseColor.a * (1.0 - diffuseColor.a) * contrast;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94), 0.55 * smoothstep(manualFieldFade.x * 0.35, manualFieldFade.y, fieldDepth));
          // Distance must not cross alphaTest: it makes opaque panes pop.
          ${clearance}
        `).replace("#include <colorspace_fragment>", `
          #include <colorspace_fragment>
          float distancePresence = 1.0 - smoothstep(manualFieldFade.x, manualFieldFade.y, manualFieldProjection.z);
          gl_FragColor.rgb = mix(vec3(247.0/255.0, 247.0/255.0, 246.0/255.0), gl_FragColor.rgb, distancePresence);
        `);
      };
      material.customProgramCacheKey = () => `manual-field-stable-columns-v3-${focus.length}`;
      materials.push(material);
      volumeMaterials.set(original, material);
      return material;
    };

    const cells = recipe.columns * recipe.rows;
    const slabs = Math.ceil((recipe.fadeTo + END_GUARD) / recipe.spacing) + 1;
    const slotsPerSlab = Math.ceil(cells / sources.length);
    const variants = sources.map(({ meshes }) => {
      const box = new Box3();
      for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!);
      }
      const centre = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const meshesInPool = meshes.map(({ geometry, material }) => {
        const pool = new InstancedMesh(geometry, batchMaterial(material as Material), slabs * slotsPerSlab);
        pool.instanceMatrix.setUsage(DynamicDrawUsage);
        pool.count = 0;
        pool.frustumCulled = false;
        // Opaque near strata write depth first, rejecting covered far fragments.
        // Transparent line primitives retain their back-to-front ordering.
        pool.renderOrder = (material as Material).transparent ? recipe.order : -recipe.order;
        group.add(pool);
        batches.push(pool);
        return pool;
      });
      return {
        centre, size, meshes: meshesInPool, count: 0,
        slotToDense: new Int32Array(slabs * slotsPerSlab).fill(-1),
        denseToSlot: new Int32Array(slabs * slotsPerSlab),
      };
    });

    slotCount += slabs * slotsPerSlab * variants.length;
    const indices = new Float64Array(slabs).fill(NaN);
    const variantByCell = new Uint8Array(cells);
    const used = new Uint8Array(variants.length);
    const width = 2 * (recipe.aperture * tanX + recipe.maxHeight / 2);
    const height = 2 * (recipe.aperture * tanY + recipe.maxHeight / 2);
    let previousStart = NaN;

    const populate = (slab: number, ringSlot: number) => {
      // Remove this expired slab from dense draw buffers. Swap with the last
      // live instance, so rejected cells cost no vertices and no draw slots.
      for (const variant of variants) {
        for (let slot = ringSlot * slotsPerSlab; slot < (ringSlot + 1) * slotsPerSlab; slot++) {
          const dense = variant.slotToDense[slot]!;
          if (dense < 0) continue;
          const last = --variant.count;
          if (dense !== last) {
            const movedSlot = variant.denseToSlot[last]!;
            variant.denseToSlot[dense] = movedSlot;
            variant.slotToDense[movedSlot] = dense;
            for (const mesh of variant.meshes) {
              mesh.instanceMatrix.array.copyWithin(dense * 16, last * 16, (last + 1) * 16);
              mesh.instanceMatrix.addUpdateRange(dense * 16, 16);
            }
          }
          variant.slotToDense[slot] = -1;
        }
      }
      const random = randomFrom(recipe.seed ^ Math.imul(slab, 0x9e3779b1));
      const densityRandom = randomFrom(recipe.seed ^ Math.imul(slab, 0x85ebca6b) ^ 0x165667b1);
      const phase = Math.floor(random() * variants.length);
      for (let i = 0; i < cells; i++) variantByCell[i] = (phase + i) % variants.length;
      for (let i = cells - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const other = variantByCell[j]!;
        variantByCell[j] = variantByCell[i]!;
        variantByCell[i] = other;
      }
      used.fill(0);
      for (let cell = 0; cell < cells; cell++) {
        const index = variantByCell[cell]!;
        const variant = variants[index]!;
        const scale = (recipe.minHeight + random() * (recipe.maxHeight - recipe.minHeight)) / variant.size.y;
        const column = cell % recipe.columns, row = Math.floor(cell / recipe.columns);
        let x = ((column + random()) / recipe.columns - 0.5) * width;
        const y = ((row + random()) / recipe.rows - 0.5) * height;
        const z = -(slab + random()) * recipe.spacing;
        // Decide once in world space. The previous projected/depth mask made
        // hidden strips materialise near the camera as its aperture changed.
        // Keep outer columns untouched; thin only the central route columns.
        const corridor = corridorAt(z);
        const centreX = 1 - smoothStep(0.34, 0.84, Math.abs(routeX + x - corridor.x) / (recipe.aperture * tanX));
        const centreY = 1 - smoothStep(0.28, 0.76, Math.abs(routeY + y - corridor.y) / (recipe.aperture * tanY));
        // A modest, depth-independent reduction in both opening and manual worlds.
        // Reuse the same cell sample so remaining screens never move or pop on revisits.
        if (densityRandom() > 0.86 * (1 - (options.centreThinning ?? 0.7) * centreX * centreY)) continue;
        // Only exclude contact with the camera at the near plane. A strip can
        // still cross the centre of the image at any normal viewing distance.
        const nearX = scale * variant.size.x / 2 + camera.near * tanX + 0.02;
        const nearY = scale * variant.size.y / 2 + camera.near * tanY + 0.02;
        if (Math.abs(x) < nearX && Math.abs(y) < nearY) x = x < 0 ? -nearX : nearX;
        instance.makeScale(scale, scale, scale).setPosition(
          routeX + x - variant.centre.x * scale,
          routeY + y - variant.centre.y * scale,
          z - variant.centre.z * scale,
        );
        const slot = ringSlot * slotsPerSlab + used[index]!;
        used[index] = used[index]! + 1;
        const dense = variant.count++;
        variant.slotToDense[slot] = dense;
        variant.denseToSlot[dense] = slot;
        for (const mesh of variant.meshes) {
          mesh.setMatrixAt(dense, instance);
          mesh.instanceMatrix.addUpdateRange(dense * 16, 16);
        }
      }
      for (const variant of variants) {
        for (const mesh of variant.meshes) {
          mesh.count = variant.count;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    };

    return { update(along: number) {
      const start = Math.floor((along - END_GUARD) / recipe.spacing);
      if (start === previousStart) return;
      previousStart = start;
      for (let slab = start; slab < start + slabs; slab++) {
        const ringSlot = ((slab % slabs) + slabs) % slabs;
        if (indices[ringSlot] === slab) continue;
        populate(slab, ringSlot);
        indices[ringSlot] = slab;
      }
    } };
  });

  const replaced = volumes.length ? staticField : [];
  if (replaced.length) {
    // Detach static subtrees so their matrices and visibility no longer need
    // walking each frame. Keep their resources alive for the instance batches.
    for (const { node } of replaced) node.removeFromParent();
    root.add(group);
    // The full emergence ramp must be inside the lens' depth range. Restore
    // the imported clipping distance with the rest of this presentation layer.
    camera.far = Math.max(originalFar, ...VOLUMES.map((recipe) => recipe.fadeTo + END_GUARD));
    camera.updateProjectionMatrix();
  }

  const vertex = new Vector3(), modelView = new Matrix4();
  const updateFocus = () => {
    focusCount.value = 0;
    for (const { mesh, bounds, depthAndWeight } of focus) {
      depthAndWeight.set(0, 0);
      if (!mesh.visible) continue;
      modelView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      bounds.set(Infinity, Infinity, -Infinity, -Infinity);
      let depth = Infinity;
      const positions = mesh.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(modelView);
        depth = Math.min(depth, -vertex.z);
        if (depth <= camera.near) break;
        vertex.applyMatrix4(camera.projectionMatrix);
        bounds.set(Math.min(bounds.x, vertex.x), Math.min(bounds.y, vertex.y),
          Math.max(bounds.z, vertex.x), Math.max(bounds.w, vertex.y));
      }
      if (depth <= camera.near || bounds.x > 1 || bounds.z < -1 || bounds.y > 1 || bounds.w < -1) {
        bounds.set(0, 0, 0, 0);
        continue;
      }
      const extent = Math.max(bounds.z - bounds.x, bounds.w - bounds.y);
      const progress = Math.max(0, Math.min(1, (extent - 0.13) / 0.27));
      depthAndWeight.set(depth, progress * progress * (3 - 2 * progress));
      if (progress > 0) {
        focusBounds.value[focusCount.value] = bounds;
        focusDepths.value[focusCount.value++] = depthAndWeight;
      }
    }
  };

  let disposed = false;
  return {
    slotCount,
    batchCount: batches.length,
    update() {
      if (disposed || !volumes.length) return;
      cameraWorld.setFromMatrixPosition(camera.matrixWorld);
      for (const volume of volumes) volume.update(-cameraWorld.z);
      updateFocus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const batch of batches) batch.dispose();
      for (const material of materials) material.dispose();
      camera.far = originalFar;
      camera.updateProjectionMatrix();
      for (const { parent, node, index } of replaced) {
        parent.add(node);
        parent.children.pop();
        parent.children.splice(index, 0, node);
      }
    },
  };
}

