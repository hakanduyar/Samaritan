import {
  CanvasTexture,
  Frustum,
  Matrix4,
  Mesh,
  SRGBColorSpace,
  TextureLoader,
  type BufferGeometry,
  type Camera,
  type Material,
  type MeshBasicMaterial,
  type Object3D,
  type Texture,
} from "three";

import { assetPath } from "../contract/assetPath";
import {
  inWindow,
  PLAY_LEAD_SECONDS,
  resolveCatalog,
  selectPrepared,
  type AnchorLike,
  type ResolvedRecordedEntry,
} from "./recordedCatalog";
import { drawMarker, parseRecordedTracking, sampleHeads, type RecordedTracking } from "./recordedTracking";

/**
 * Opt-in recorded feeds for the catalog screens. Hold windows come from the
 * manifest anchors; at most MAX_DECODERS decoders exist at once (the current
 * screen and the nearest upcoming one). Each is prepared on the approach and
 * released once the route has moved on. A failure affects only its own screen.
 */
export interface RecordedFeedController {
  /** Route time in seconds; camera is used for frustum visibility when given. */
  update(time: number, camera?: Camera): void;
  dispose(): void;
}

interface Session {
  setPlaying(playing: boolean): void;
  close(): void;
}

interface Slot {
  entry: ResolvedRecordedEntry;
  /** Starts the poster and tracking requests once; later calls do nothing. */
  load(): void;
  ready(): boolean;
  pause(): void;
  /** Closes the decoder only; the poster mapping stays. */
  release(): void;
  play(visible: boolean, camera?: Camera): void;
  dispose(): void;
}

const NOOP: RecordedFeedController = { update() {}, dispose() {} };

export function createRecordedFeed(
  root: Object3D,
  doc: Document,
  invalidate: () => void,
  anchors: readonly AnchorLike[] | undefined,
): RecordedFeedController {
  const abort = new AbortController();
  const frustum = new Frustum();
  const projection = new Matrix4();
  let disposed = false;
  const wake = () => { if (!disposed) invalidate(); };

  function createSlot(entry: ResolvedRecordedEntry, mesh: Mesh): Slot {
    const originalGeometry: BufferGeometry = mesh.geometry;
    const originalMaterial = mesh.material as MeshBasicMaterial;
    let posterGeometry: BufferGeometry | null = null;
    let posterMaterial: MeshBasicMaterial | null = null;
    let posterTexture: Texture | null = null;
    let tracking: RecordedTracking | null = null;
    let session: Session | null = null;
    let loading = false;
    let failed = false;
    let gone = false;

    function openSession(): Session {
      const video = doc.createElement("video");
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.loop = true;
      video.preload = "auto";
      video.src = assetPath(entry.video);

      const canvas = doc.createElement("canvas");
      const context = canvas.getContext("2d");
      const texture = new CanvasTexture(canvas);
      // glTF-style top-left UVs: same convention as the loaded atlas texture.
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      const material = posterMaterial!.clone();
      material.map = texture;
      material.needsUpdate = true;

      let active = false;
      let released = false;
      let pending = false;
      let sized = false;
      let hasFrame = false;
      let frameHandle = 0;
      const frameCallbacks = typeof video.requestVideoFrameCallback === "function";

      // Video pixels and overlay share one canvas, so they cannot drift apart.
      const paint = (time: number) => {
        if (!context || released || video.seeking || video.readyState < 2) return;
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return;
        if (!sized) {
          // Sized once, before the first upload; the GPU texture is never resized.
          canvas.width = width;
          canvas.height = height;
          sized = true;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (tracking) for (const head of sampleHeads(tracking, time)) drawMarker(context, canvas.width, canvas.height, head);
        hasFrame = true;
        texture.needsUpdate = true;
        if (active) mesh.material = material;
        wake();
      };
      // mediaTime is the timestamp of the exact pixels that were decoded.
      const presented = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (released) return;
        paint(metadata.mediaTime);
        frameHandle = video.requestVideoFrameCallback(presented);
      };
      const fallbackPaint = () => { if (!frameCallbacks) paint(video.currentTime); };
      const onSeeking = () => wake();
      const fail = () => {
        if (released) return;
        failed = true;
        close();
        wake();
      };
      const setPlaying = (playing: boolean) => {
        active = playing && !doc.hidden && !released;
        if (!active) { video.pause(); return; }
        fallbackPaint();
        if (hasFrame && !video.seeking) mesh.material = material;
        if (video.paused && !pending) {
          pending = true;
          void video.play()
            .then(() => { if (!active || released || doc.hidden) video.pause(); else wake(); })
            .catch(fail)
            .finally(() => { pending = false; });
        }
      };
      const ready = () => { fallbackPaint(); setPlaying(active); wake(); };

      if (frameCallbacks) frameHandle = video.requestVideoFrameCallback(presented);
      video.addEventListener("seeking", onSeeking);
      video.addEventListener("timeupdate", fallbackPaint);
      video.addEventListener("loadeddata", ready);
      video.addEventListener("seeked", ready);
      video.addEventListener("error", fail);
      video.load();

      function close() {
        if (released) return;
        released = true;
        active = false;
        if (frameCallbacks) video.cancelVideoFrameCallback(frameHandle);
        video.removeEventListener("seeking", onSeeking);
        video.removeEventListener("timeupdate", fallbackPaint);
        video.removeEventListener("loadeddata", ready);
        video.removeEventListener("seeked", ready);
        video.removeEventListener("error", fail);
        video.pause();
        if (posterMaterial) mesh.material = posterMaterial;
        // Dropping the source releases the decoder.
        video.removeAttribute("src");
        video.load();
        material.dispose();
        texture.dispose();
        if (session === handle) session = null;
      }
      const handle: Session = { setPlaying, close };
      return handle;
    }

    function load() {
      if (loading || gone) return;
      loading = true;

      // Tracking is tiny and optional: playback never depends on it.
      void fetch(assetPath(entry.tracking), { signal: abort.signal })
        .then((response) => { if (!response.ok) throw new Error("Tracking unavailable"); return response.json(); })
        .then((json) => { tracking = parseRecordedTracking(json); wake(); })
        .catch(() => { /* Video remains available without overlay. */ });

      // The poster is the fallback image. Only once it has loaded is the atlas
      // mapping replaced by a full-texture mapping, so a failure keeps the original.
      void new TextureLoader().loadAsync(assetPath(entry.poster)).then((texture) => {
        const uv = mesh.geometry.getAttribute("uv");
        if (gone || !uv) { texture.dispose(); return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < uv.count; i++) {
          minX = Math.min(minX, uv.getX(i)); maxX = Math.max(maxX, uv.getX(i));
          minY = Math.min(minY, uv.getY(i)); maxY = Math.max(maxY, uv.getY(i));
        }
        if (!(maxX > minX && maxY > minY)) { texture.dispose(); return; }
        const geometry = mesh.geometry.clone();
        const cloned = geometry.getAttribute("uv");
        // Orientation is preserved; the atlas sub-rectangle is stretched to the full poster.
        for (let i = 0; i < cloned.count; i++) cloned.setXY(i, (cloned.getX(i) - minX) / (maxX - minX), (cloned.getY(i) - minY) / (maxY - minY));
        cloned.needsUpdate = true;
        texture.flipY = false;
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        const material = originalMaterial.clone();
        material.map = texture;
        material.needsUpdate = true;
        posterGeometry = geometry;
        posterMaterial = material;
        posterTexture = texture;
        mesh.geometry = geometry;
        mesh.material = material;
        wake();
      }).catch(() => { failed = true; /* Original atlas image remains. */ });
    }

    return {
      entry,
      load,
      ready: () => posterMaterial !== null && !failed && !gone,
      pause() { session?.setPlaying(false); },
      release() { session?.close(); },
      play(visible, camera) {
        if (gone || failed || !posterMaterial) return;
        let inView = visible && mesh.visible;
        if (inView && camera) {
          camera.updateMatrixWorld();
          mesh.updateWorldMatrix(true, false);
          frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          inView = frustum.intersectsObject(mesh);
        }
        session ??= openSession();
        session.setPlaying(inView);
      },
      dispose() {
        if (gone) return;
        gone = true;
        session?.close();
        mesh.geometry = originalGeometry;
        mesh.material = originalMaterial as Material;
        posterGeometry?.dispose();
        posterMaterial?.dispose();
        posterTexture?.dispose();
        posterGeometry = null; posterMaterial = null; posterTexture = null;
      },
    };
  }

  const slots: Slot[] = [];
  for (const entry of resolveCatalog(anchors)) {
    const found = root.getObjectByName(entry.screen);
    if (!(found instanceof Mesh) || Array.isArray(found.material) || !(found.material as MeshBasicMaterial).map) continue;
    slots.push(createSlot(entry, found));
  }
  if (slots.length === 0) return NOOP;

  const onVisibility = () => {
    if (doc.hidden) for (const slot of slots) slot.pause();
    wake();
  };
  doc.addEventListener("visibilitychange", onVisibility);

  return {
    update(time, camera) {
      if (disposed) return;
      const chosen = selectPrepared(slots.map((slot) => slot.entry), time);
      // Release everything outside the prepared window before any decoder is created.
      for (const slot of slots) if (!chosen.includes(slot.entry)) slot.release();
      for (const slot of slots) {
        if (!chosen.includes(slot.entry)) continue;
        slot.load();
        if (!slot.ready()) continue;
        slot.play(inWindow(slot.entry, time, PLAY_LEAD_SECONDS) && !doc.hidden, camera);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      doc.removeEventListener("visibilitychange", onVisibility);
      for (const slot of slots) slot.dispose();
    },
  };
}
