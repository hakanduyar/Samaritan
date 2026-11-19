import { LoadingManager, Mesh, WebGLRenderer, type Camera, type ColorRepresentation, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  manifestPathFor,
  resolveSceneUrl,
  validateManifest,
  type SceneManifest,
  type World,
} from "../contract/manifest";
import { disposeObjectTree } from "./dispose";
import { letterbox } from "./letterbox";
import { createSceneRig, type SceneRig } from "./sceneRig";
import {
  clampTime,
  formatTime,
  keyCommand,
  wheelDeltaSeconds,
  type PlayerParams,
} from "./time";
import { advanceNavigation, navigationTarget, HOLD_DELAY_SECONDS, MAX_PENDING_SECONDS } from "./navigation";
import { createAmbientRails } from "./ambient";
import { createRecordedFeed, type RecordedFeedController } from "./recordedFeed";

import { createHoldMap, navigationMap, focusEntry, withinFocus } from './holdMapping';
import { createExtendedHoldMap, extendRecordedRoute, extendedSamaritanAdmission } from "./extendRecordedRoute";
import { createSamaritanPhoneFraming, isPhoneViewport } from "./samaritanFraming";
import { advanceTouchTrip, createTouchTrip, hasTouchCapability, isTouchTap, swipeDirection, touchStop, type TouchTrip } from "./touchNavigation";

import { loadOpeningSequence } from './openingSequence';
import type { OpeningPhase } from './openingClock';

export const MAX_PIXEL_RATIO = 1.5;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MANUAL_PIXELS_PER_ROUTE = 14000;
const REFERENCE_PIXELS_PER_ROUTE = 24000;

export interface RendererLike {
  domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: ColorRepresentation, alpha?: number): void;
  render(scene: Object3D, camera: Camera): void;
  dispose(): void;
  forceContextLoss?(): void;
}

export type PlayerStatus =
  | { state: "loading" }
  | { state: "ready"; manifest: SceneManifest }
  | { state: "missing"; message: string; detail: string }
  | { state: "error"; message: string; detail: string };

export interface PlayerSnapshot {
  time: number;
  targetTime: number;
  duration: number;
  playing: boolean;
  settled: boolean;
}

export interface PlayerController {
  setInteractionReady(): void;
  /** Sets canonical time exactly (no easing). */
  seek(seconds: number): void;
  togglePlay(): void;
  getSnapshot(): PlayerSnapshot | null;
  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void;
}

export interface PlayerOptions {
  world: World;
  params: PlayerParams;
  /** Full-viewport element: sizing and input target. */
  host: HTMLElement;
  /** Letterboxed box that receives the canvas. */
  frame: HTMLElement;
  /** Element carrying stable data-state / data-time markers. */
  marker: HTMLElement;
  onStatus(status: PlayerStatus): void;
  createRenderer?: () => RendererLike;
  maxPixelRatio?: number;
  interactionReady?: boolean;
  openingSequence?: boolean | 'straight';
  onOpening?(state:{phase:OpeningPhase;command:string}):void;
}

export interface PlayerHandle {
  controller: PlayerController;
  dispose(): void;
}

function defaultRenderer(): RendererLike {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.debug.onShaderError = () => {
    throw new Error("The graphics driver could not compile the scene shaders.");
  };
  return renderer;
}

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null)?.response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlayer(options: PlayerOptions): PlayerHandle {
  const { world, params, host, frame, marker, onStatus } = options;
  const win = host.ownerDocument.defaultView ?? window;
  const doc = host.ownerDocument;
  const maxPixelRatio = options.maxPixelRatio ?? MAX_PIXEL_RATIO;
  const openingEnabled = options.openingSequence && world === "samaritan" && params.mode === "interactive";

  const abort = new AbortController();
  const manager = new LoadingManager();
  let startupTimer: number | undefined;
  const clearStartupTimer = () => { win.clearTimeout(startupTimer); startupTimer = undefined; };
  const startupProgress = () => {
    if (disposed || terminal) return;
    clearStartupTimer();
    startupTimer = win.setTimeout(() => {
      if (!disposed && !terminal && !ready) fail("error", "Scene asset loading stalled", "No loading progress for 45 seconds. Check your connection and retry.");
    }, 45000);
  };
  const cleanups: Array<() => void> = [];
  const listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  let disposed = false;
  let terminal = false;

  let scene: Object3D | null = null;
  let rig: SceneRig | null = null;
  let renderer: RendererLike | null = null;
  let manifest: SceneManifest | null = null;

  let opening: Awaited<ReturnType<typeof loadOpeningSequence>> | null = null;
  let openingLabel = "";
  let phoneFraming: ReturnType<typeof createSamaritanPhoneFraming> | null = null;
  let currentTime = 0;
  let targetTime = 0;
  let navigationVelocity = 0;
  // Explicit endpoint travel crosses intermediate photo holds; fresh input cancels it.
  let endpointTravel = false;
  let touchTrip: TouchTrip | null = null;
  let manualMap = createHoldMap(1, []);
  const heldKeys = new Map<string, number>();
  let heldSeconds = 0;
  let playing = false;
  let needsRender = false;
  let rafId = 0;
  let lastFrameMs: number | null = null;
  let ready = false;
  let ambient: ReturnType<typeof createAmbientRails> | null = null;
  // Opt-in (?recordedFeed=1), interactive mode only; absent otherwise.
  let recordedFeed: RecordedFeedController | null = null;
  let ambientRenderElapsed = 0;
  let interactionReady = openingEnabled ? false : options.interactionReady ?? true;
  let autoplayStarted = false;
  let resetTouch = () => {};
  const startDeferredAutoplay = () => {
    if (disposed || !ready || !interactionReady || autoplayStarted || !params.autoplay || reducedMotion) return;
    autoplayStarted = true;
    togglePlay();
  };

  const motionPreference = win.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionPreference?.matches ?? false;
  const exact = params.mode === "reference";
  const inputEnabled = params.mode === "interactive" || params.qa;
  const canStepByTouch = () => !exact && manualMap.focusHolds.length > 0 && hasTouchCapability(win);

  marker.dataset.state = "loading";
  marker.dataset.stage = "manifest";
  marker.dataset.time = "";
  onStatus({ state: "loading" });

  const setStatus = (status: PlayerStatus) => {
    if (disposed) return;
    if (status.state === "missing" || status.state === "error") terminal = true;
    marker.dataset.state = status.state;
    onStatus(status);
  };

  const fail = (state: "missing" | "error", message: string, detail: string) => {
    if (disposed || terminal) return;
    terminal = true;
    clearStartupTimer();
    abort.abort();
    manager.abort();
    teardownScene();
    setStatus({ state, message, detail });
  };

  const snapshot = (): PlayerSnapshot | null =>
    rig
      ? {
          time: currentTime,
          targetTime,
          duration: rig.duration,
          playing,
          settled: !playing && !touchTrip && currentTime === targetTime && navigationVelocity === 0,
        }
      : null;

  const publish = () => {
    const snap = snapshot();
    if (!snap) return;
    marker.dataset.time = formatTime(snap.time);
    marker.dataset.settled = String(snap.settled);
    marker.dataset.playing = String(snap.playing);
    for (const listener of listeners) listener(snap);
  };

  const renderNow = () => {
    if (!rig || !renderer || !scene) return;
    const state=opening?.clock.snapshot();
    if(state){marker.dataset.openingPhase=state.phase;marker.dataset.openingTime=formatTime(state.clipTime);}
    if(opening && state && state.phase!=='complete'){
      // Keep the opaque command frame during the straight variant's masked return.
      if(!opening.maskedReturn||state.phase!=='return'){
        opening.rig.seek(state.clipTime);opening.prepare();renderer.render(opening.scene,opening.rig.camera);
      }
    }else{
      currentTime=rig.seek(currentTime);ambient?.apply();
      // Only the interactive world is ever updated: never during the opening, and idle (released) under reduced motion or before interaction is ready.
      recordedFeed?.update(interactionReady&&!reducedMotion?currentTime:Number.NEGATIVE_INFINITY,rig.camera);
      renderer.render(scene,rig.camera);
    }
    if(state && openingLabel!==state.phase+state.command){openingLabel=state.phase+state.command;options.onOpening?.({phase:state.phase,command:state.command});}
    needsRender = false;
    publish();
  };

  const ambientRunning = () => ready && interactionReady && !reducedMotion && Boolean(ambient?.selection.length);
  const isAnimating = () => (ready && opening !== null && opening.clock.snapshot().phase !== 'complete') || playing || touchTrip !== null || currentTime !== targetTime || navigationVelocity !== 0 || heldKeys.size > 0 || ambientRunning();

  const schedule = () => {
    if (disposed || rafId !== 0 || doc.hidden) return;
    if (!needsRender && !isAnimating()) return;
    rafId = win.requestAnimationFrame(tick);
  };

  function tick(nowMs: number) {
    rafId = 0;
    if (!rig) return;
    const elapsed = lastFrameMs === null ? 0 : Math.max((nowMs - lastFrameMs) / 1000, 0);
    const dt = Math.min(elapsed, MAX_FRAME_DELTA_SECONDS);
    lastFrameMs = nowMs;
    const before = currentTime;
    let handedOff=false;
    if(ready && opening && opening.clock.snapshot().phase!=='complete'){
      const state=opening.clock.advance(elapsed,reducedMotion);needsRender=true;
      if(state.phase==='complete'){
        handedOff=true;currentTime=targetTime=0;navigationVelocity=0;
        heldKeys.clear();heldSeconds=0;resetTouch();ambient?.reset();
        interactionReady=true;
        if(options.openingSequence==='straight'||phoneFraming)layout();
      }
    }
    if (!exact && heldKeys.size > 0 && interactionReady) {
      heldSeconds += dt;
      if (heldSeconds >= HOLD_DELAY_SECONDS) {
        const direction = Math.sign([...heldKeys.values()].reduce((a, b) => a + b, 0));
        targetTime = manualMap.toClip(manualMap.toNavigation(currentTime) + direction * MAX_PENDING_SECONDS);
      }
    }
    if (playing) {
      targetTime = clampTime(targetTime + elapsed, rig.duration);
      currentTime = targetTime;
      if (targetTime >= rig.duration) playing = false;
    } else if (touchTrip) {
      // Trips follow real elapsed time, so frame rate cannot change their length.
      const position = advanceTouchTrip(touchTrip, elapsed);
      if (touchTrip.elapsed === touchTrip.duration) {
        currentTime = targetTime;
        touchTrip = null;
      } else {
        currentTime = manualMap.toClip(position);
      }
    } else if (currentTime !== targetTime || navigationVelocity !== 0) {
      if (exact) { currentTime = targetTime; navigationVelocity = 0; }
      else {
        const navTarget = manualMap.toNavigation(targetTime);
        const next = advanceNavigation(manualMap.toNavigation(currentTime), navTarget, navigationVelocity, dt);
        const navCurrent = clampTime(next.current, manualMap.duration);
        currentTime = navCurrent === navTarget ? targetTime : manualMap.toClip(navCurrent);
        navigationVelocity = navCurrent === next.current ? next.velocity : 0;
        const focus = heldKeys.size || endpointTravel ? null : focusEntry(before, currentTime, manualMap.focusHolds);
        if (focus !== null) { currentTime = focus; targetTime = focus; navigationVelocity = 0; }
      }
    }
    if (currentTime === targetTime && navigationVelocity === 0) endpointTravel = false;
    let ambientFrame = false;
    if (ambientRunning()) {
      ambient!.advance(handedOff ? 0 : elapsed);
      ambientRenderElapsed += elapsed;
      ambientFrame = ambientRenderElapsed >= 1 / 30;
    }
    if (needsRender || currentTime !== before || ambientFrame) {
      renderNow();
      ambientRenderElapsed = 0;
    }
    if(handedOff) startDeferredAutoplay();
    if (isAnimating()) schedule();
    else lastFrameMs = null;
  }

  const requestRender = () => {
    needsRender = true;
    schedule();
  };

  const stopNavigation = () => {
    touchTrip = null;
    endpointTravel = false;
    targetTime = currentTime;
    navigationVelocity = 0;
  };

  const setTarget = (seconds: number, immediate: boolean, travel: "manual" | "endpoint" | "touch" = "manual") => {
    if (!rig) return;
    endpointTravel = travel === "endpoint" && !immediate;
    targetTime = clampTime(seconds, rig.duration);
    touchTrip = travel === "touch" && !immediate && currentTime !== targetTime
      ? createTouchTrip(manualMap.toNavigation(currentTime), manualMap.toNavigation(targetTime))
      : null;
    if (immediate) { currentTime = targetTime; navigationVelocity = 0; }
    publish();
    requestRender();
  };

  const applyManualDelta = (delta: number) => {
    if (!rig) return;
    playing = false;
    if (touchTrip) stopNavigation();
    setTarget(exact ? targetTime + delta : manualMap.toClip(navigationTarget(manualMap.toNavigation(currentTime), manualMap.toNavigation(targetTime), delta)), exact);
  };

  const togglePlay = () => {
    if (!rig) return;
    if (touchTrip) stopNavigation();
    endpointTravel = false;
    heldKeys.clear(); heldSeconds = 0;
    if (playing) {
      playing = false;
    } else {
      targetTime = currentTime >= rig.duration ? 0 : currentTime;
      currentTime = targetTime;
      navigationVelocity = 0;
      playing = true;
      lastFrameMs = null;
    }
    publish();
    requestRender();
  };

  const layout = () => {
    if (!renderer || !manifest) return;
    const straightVisible=options.openingSequence==='straight'&&opening?.clock.snapshot().phase!=='complete';
    const frozenReturn=straightVisible&&opening?.clock.snapshot().phase==='return';
    const width=Math.max(host.clientWidth,host.clientHeight*manifest.sourceAspectRatio);
    const height=width/manifest.sourceAspectRatio;
    // Phones render the whole viewport directly so focused panes are not cropped by the cover canvas.
    const openingVisible = opening?.clock.snapshot().phase !== undefined && opening.clock.snapshot().phase !== 'complete';
    const phone = Boolean(phoneFraming) && !openingVisible && isPhoneViewport(win, host.clientWidth, host.clientHeight);
    const rect = phone
      ? {x:0,y:0,width:host.clientWidth,height:host.clientHeight}
      : straightVisible || (world==='samaritan' && !exact)
      ? {x:(host.clientWidth-width)/2,y:(host.clientHeight-height)/2,width,height}
      : letterbox(host.clientWidth, host.clientHeight, manifest.sourceAspectRatio);
    frame.style.left = `${rect.x}px`;
    frame.style.top = `${rect.y}px`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;
    // CSS cover-fit can resize the frozen command without clearing its buffer.
    if(frozenReturn)return;
    if(phoneFraming){ if(phone) phoneFraming.fit(host.clientWidth,host.clientHeight); else phoneFraming.restore(); }
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    requestRender();
  };

  const listen = (
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  };

  const attachInput = () => {
    if (motionPreference) listen(motionPreference, "change", () => {
      reducedMotion = motionPreference.matches;
      ambient?.reset(); ambientRenderElapsed = 0;
      if (reducedMotion) {
        playing = false; heldKeys.clear(); heldSeconds = 0;
        stopNavigation(); resetTouch();
      }
      lastFrameMs = null;
      requestRender();
    });
    listen(doc, "visibilitychange", () => {
      if (doc.hidden) {
        const cancelledTouchTrip = touchTrip !== null;
        heldKeys.clear(); heldSeconds = 0;
        resetTouch();
        stopNavigation();
        if (rafId !== 0) win.cancelAnimationFrame(rafId);
        rafId = 0;
        lastFrameMs = null;
        if (cancelledTouchTrip) publish();
      } else {
        schedule();
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => layout());
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
    } else {
      listen(win, "resize", () => layout());
    }

    if (!inputEnabled) return;

    listen(
      host,
      "wheel",
      (event) => {
        const wheel = event as WheelEvent;
        if (!rig) return;
        wheel.preventDefault();
        if (!interactionReady || doc.hidden) return;
        playing = false;
        const delta = wheelDeltaSeconds(wheel.deltaY, wheel.deltaMode, host.clientHeight, manualMap.duration, exact ? REFERENCE_PIXELS_PER_ROUTE : MANUAL_PIXELS_PER_ROUTE);
        applyManualDelta(delta);
      },
      { passive: false },
    );

    listen(win, "keydown", (event) => {
      const key = event as KeyboardEvent;
      if (!interactionReady || doc.hidden) return;
      if (!rig || key.altKey || key.ctrlKey || key.metaKey) return;
      const target = key.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      const command = keyCommand(key.key);
      if (!command) return;
      key.preventDefault();
      if (key.repeat) return;
      if (command.type === "toggle") {
        togglePlay();
        return;
      }
      playing = false;
      if (command.type === "jump") {
        heldKeys.clear(); heldSeconds = 0; resetTouch();
        setTarget(command.to === "start" ? 0 : rig.duration, exact, "endpoint");
      }
      else {
        if (!exact) { heldKeys.set(key.key, Math.sign(command.seconds)); heldSeconds = 0; }
        applyManualDelta(command.seconds);
      }
    });
    listen(win, "keyup", (event) => {
      heldKeys.delete((event as KeyboardEvent).key);
      if (!heldKeys.size) {
        heldSeconds = 0;
        if (!exact && !endpointTravel && !touchTrip && withinFocus(currentTime, manualMap.focusHolds)) { targetTime = currentTime; navigationVelocity = 0; requestRender(); }
      }
    });
    listen(win, "blur", () => {
      heldKeys.clear(); heldSeconds = 0;
      resetTouch();
      stopNavigation();
      requestRender();
    });

    let drag: { id: number; y: number } | null = null;
    let swipe: { id: number; x: number; y: number; canTap: boolean } | null = null;
    resetTouch = () => { drag = null; swipe = null; };
    listen(host, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (!interactionReady || doc.hidden) { resetTouch(); return; }
      if (pointer.pointerType === "mouse") return;
      if (pointer.pointerType === "touch") {
        swipe = null;
        if (canStepByTouch() || touchTrip) {
          drag = null;
          if (!ready || pointer.isPrimary === false) return;
          const target = pointer.target;
          if (target instanceof Element && target.closest("a, button, input, select, textarea")) return;
          swipe = { id: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, canTap: Boolean(touchTrip) };
          if (pointer.isTrusted) {
            try { host.setPointerCapture(pointer.pointerId); } catch { /* capture is optional */ }
          }
          return;
        }
      }
      drag = { id: pointer.pointerId, y: pointer.clientY };
    });
    listen(host, "pointermove", (event) => {
      const pointer = event as PointerEvent;
      if (!interactionReady || doc.hidden) { resetTouch(); return; }
      if (swipe && swipe.id === pointer.pointerId) {
        if (swipe.canTap) swipe.canTap = isTouchTap(pointer.clientX - swipe.x, pointer.clientY - swipe.y);
        return;
      }
      if (!rig || !drag || drag.id !== pointer.pointerId) return;
      const dy = drag.y - pointer.clientY;
      drag.y = pointer.clientY;
      playing = false;
      applyManualDelta((dy / (exact ? REFERENCE_PIXELS_PER_ROUTE : MANUAL_PIXELS_PER_ROUTE)) * manualMap.duration);
    });
    const cancelSwipe = () => {
      swipe = null;
      stopNavigation();
      publish();
      requestRender();
    };
    const finishDrag = (pointer: PointerEvent) => {
      if (pointer.pointerType === "touch" && canStepByTouch() && drag?.id !== pointer.pointerId) return;
      drag = null;
      if (!exact && !endpointTravel && !touchTrip && withinFocus(currentTime, manualMap.focusHolds)) {
        stopNavigation();
        requestRender();
      }
    };
    listen(host, "pointerup", (event) => {
      const pointer = event as PointerEvent;
      if (!swipe || swipe.id !== pointer.pointerId) { finishDrag(pointer); return; }
      const { x, y, canTap } = swipe;
      swipe = null;
      if (!rig || !interactionReady || doc.hidden || (!canStepByTouch() && !touchTrip)) return;
      const dx = pointer.clientX - x;
      const dy = pointer.clientY - y;
      const direction = swipeDirection(dx, dy);
      if (direction && canStepByTouch()) {
        const destination = touchStop(currentTime, direction, rig.duration, manualMap.focusHolds);
        // A repeat toward the stop already underway never queues another stop.
        if (touchTrip && destination === targetTime) return;
        playing = false;
        heldKeys.clear(); heldSeconds = 0;
        stopNavigation();
        setTarget(destination, reducedMotion, "touch");
      } else if (touchTrip && canTap && isTouchTap(dx, dy)) {
        stopNavigation();
        publish();
        requestRender();
      }
    });
    listen(host, "pointercancel", (event) => {
      const pointer = event as PointerEvent;
      if (swipe && swipe.id === pointer.pointerId) { cancelSwipe(); return; }
      finishDrag(pointer);
    });
    // Capture is also released after a normal pointerup; by then swipe is already null, so only an interrupted gesture cancels.
    listen(host, "lostpointercapture", (event) => {
      if (swipe?.id === (event as PointerEvent).pointerId) cancelSwipe();
    });
  };

  function teardownScene() {
    if (rafId !== 0) win.cancelAnimationFrame(rafId);
    rafId = 0;
    while (cleanups.length > 0) cleanups.pop()?.();
    opening?.dispose();opening=null;
    recordedFeed?.dispose();recordedFeed=null;
    rig?.dispose();
    rig = null;
    ambient?.reset(); ambient = null;
    if (scene) disposeObjectTree(scene);
    scene = null;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    }
    renderer = null;
    ready = false;
  }

  const start = async () => {
    if (params.errors.length > 0) {
      fail("error", "Invalid player parameters", params.errors.join("; "));
      return;
    }

    const manifestUrl = new URL(manifestPathFor(world), win.location.href).href;
    let response: Response;
    try {
      response = await fetch(manifestUrl, { signal: abort.signal, cache: "no-store" });
    } catch (error) {
      if (!disposed) fail("error", "Manifest request failed", `${manifestUrl}: ${describe(error)}`);
      return;
    }
    if (disposed || terminal) return;
    if (response.status === 404) {
      fail(
        "missing",
        "Scene asset bundle not present",
        `${manifestPathFor(world)} was not found (404). No scene is shown until the producer bundle is admitted.`,
      );
      return;
    }
    if (!response.ok) {
      fail("error", "Manifest request failed", `${manifestUrl} responded ${response.status}`);
      return;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      if (!disposed) fail("error", "Manifest is not valid JSON", describe(error));
      return;
    }
    if (disposed || terminal) return;
    startupProgress();

    const validation = validateManifest(json, world);
    if (!validation.ok) {
      fail("error", "Manifest violates contract", validation.errors.join("; "));
      return;
    }
    manifest = validation.manifest;
    manualMap = navigationMap(manifest, exact);
    // Opt-in extended itinerary: only after the exact base signature was admitted by navigationMap.
    const search = new URLSearchParams(win.location.search);
    const extendItinerary = world === "samaritan" && params.mode === "interactive" && !exact && !reducedMotion
      && search.get("recordedFeed") === "1" && search.get("itinerary") === "extended" && manualMap.focusHolds.length > 0;
    marker.dataset.stage = "scene-assets";
    if (params.requestedTime !== null && params.requestedTime > (extendItinerary ? extendedSamaritanAdmission.durationSeconds : manifest.durationSeconds)) {
      fail(
        "error",
        "Reference time outside clip",
        `t=${params.requestedTime} exceeds durationSeconds ${extendItinerary ? extendedSamaritanAdmission.durationSeconds : manifest.durationSeconds}`,
      );
      return;
    }

    let sceneUrl: string;
    try {
      sceneUrl = resolveSceneUrl(manifestUrl, manifest.sceneUrl);
    } catch (error) {
      fail("error", "Manifest violates contract", describe(error));
      return;
    }

    const failedResources: string[] = [];
    manager.onError = (url) => failedResources.push(url);
    let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
    try {
      // The two independent bundles may download/decode together. Each owns
      // late completion cleanup if its peer fails or the player is disposed.
      let worldBytes = 0;
      const worldLoad = new GLTFLoader(manager).loadAsync(sceneUrl, (event) => {
        if (Number.isFinite(event.loaded) && event.loaded > worldBytes) { worldBytes = event.loaded; startupProgress(); }
      }).then((value) => {
        if (disposed || terminal) disposeObjectTree(value.scene);
        else scene = value.scene;
        return value;
      });
      const openingLoad = openingEnabled
        ? loadOpeningSequence(win.location.href, abort.signal, options.openingSequence === 'straight', startupProgress).then((value) => {
          if (disposed || terminal) value.dispose();
          else opening = value;
        })
        : Promise.resolve();
      [gltf] = await Promise.all([worldLoad, openingLoad]);
    } catch (error) {
      if (disposed) return;
      if (openingEnabled) {
        fail("error", "Startup assets failed to load", describe(error));
        return;
      }
      if (httpStatusOf(error) === 404) {
        fail("missing", "Scene file not present", `${manifest.sceneUrl} was not found (404).`);
      } else {
        fail("error", "Scene failed to load", `${manifest.sceneUrl}: ${describe(error)}`);
      }
      return;
    }
    if (disposed || terminal) return;
    clearStartupTimer(); // Downloads finished; a hidden tab may legitimately defer its first frame.
    scene = gltf.scene;
    if (manifest.anchors?.some((anchor) => !scene!.getObjectByName(anchor.screen) || !scene!.getObjectByName(anchor.anchorNode))) {
      fail("error", "Scene violates contract", "An authored screen or anchor is absent from the imported world");
      return;
    }
    marker.dataset.stage = "scene-contract";
    if (world === "samaritan" && params.mode === "interactive" && manifest.clipName === "samaritan_interactive") {
      ambient = createAmbientRails(scene, gltf.animations,
        [manifest.focalScreenName, ...(manifest.anchors ?? []).flatMap((anchor) => [anchor.screen, anchor.anchorNode])]);
      marker.dataset.ambientRails = String(ambient.selection.length);
    }
    // Preserve authored status geometry in reference mode only.
    if (world === "samaritan" && params.mode === "interactive") {
      const statusPanel = scene.getObjectByName("status_rig");
      if (statusPanel) statusPanel.visible = false;
      const vignette=scene.getObjectByName('fx_vignette');
      if(vignette instanceof Mesh&&!Array.isArray(vignette.material))vignette.material.opacity*=.08;
    }
    if (failedResources.length > 0) {
      fail("error", "Scene resources failed to load", failedResources.join(", "));
      return;
    }

    if (extendItinerary) {
      try {
        manifest = extendRecordedRoute(gltf.scene, gltf.animations, manifest);
        if (manifest.durationSeconds !== extendedSamaritanAdmission.durationSeconds) throw new Error("Recorded route extension was not applied");
        manualMap = createExtendedHoldMap();
      } catch (error) {
        fail("error", "Scene violates contract", describe(error));
        return;
      }
    }

    try {
      rig = createSceneRig(gltf.scene, gltf.animations, manifest);
    } catch (error) {
      fail("error", "Scene violates contract", describe(error));
      return;
    }

    try {
      renderer = (options.createRenderer ?? defaultRenderer)();
    } catch (error) {
      fail("error", "WebGL unavailable", describe(error));
      return;
    }
    marker.dataset.stage = "first-frame";
    listen(renderer.domElement, "webglcontextlost", (event) => {
      event.preventDefault();
      fail("error", "Graphics connection lost", "Reload this page to initialize the scene again.");
    });
    renderer.setClearColor(manifest.backgroundColor ?? "#000000", 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    frame.appendChild(renderer.domElement);

    // The imported camera keeps its authored transform and FOV; only the
    // projection aspect is set to the source footage aspect (letterboxed).
    rig.camera.aspect = manifest.sourceAspectRatio;
    rig.camera.updateProjectionMatrix();

    // Measured from the admitted manifest anchors before the initial pose is rendered.
    if (world === "samaritan" && !exact && params.mode === "interactive") phoneFraming = createSamaritanPhoneFraming(gltf.scene, rig, manifest);

    if (world === "samaritan" && params.mode === "interactive" && new URLSearchParams(win.location.search).get("recordedFeed") === "1") {
      recordedFeed = createRecordedFeed(scene, doc, requestRender, manifest.anchors);
    }

    currentTime = targetTime = params.requestedTime ?? 0;
    attachInput();
    layout();
    if (rafId !== 0) win.cancelAnimationFrame(rafId);
    rafId = 0;
    renderNow();

    // Ready only after the frame for the requested time has been rendered and
    // the browser has had one frame to present it.
    win.requestAnimationFrame(() => {
      if (disposed || terminal || !rig || !manifest) return;
      ready = true;
      marker.dataset.stage = "ready";
      setStatus({ state: "ready", manifest });
      publish();
      startDeferredAutoplay();
      if(opening) requestRender();
    });
  };

  // Renderer setup, canvas sizing and the first render can also fail after
  // WebGL construction succeeds. Never strand the opening in loading state.
  startupProgress();
  void start().catch((error: unknown) => {
    if (!disposed && !terminal) fail("error", "Scene initialization failed", describe(error));
  });

  return {
    controller: {
      setInteractionReady() {
        if (disposed || interactionReady || (opening && opening.clock.snapshot().phase!=='complete')) return;
        resetTouch();
        interactionReady = true;
        startDeferredAutoplay();
        requestRender();
      },
      seek(seconds) {
        if (!ready || !interactionReady) return;
        playing = false;
        setTarget(seconds, true);
      },
      togglePlay() {
        if (ready && interactionReady) togglePlay();
      },
      getSnapshot: snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearStartupTimer();
      abort.abort();
      manager.abort();
      listeners.clear();
      teardownScene();
    },
  };
}
