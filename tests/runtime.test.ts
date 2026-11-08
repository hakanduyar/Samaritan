// @vitest-environment jsdom
import { BufferGeometry, Mesh, Vector3, type Camera, type ColorRepresentation, type Object3D } from "three";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createPlayer, type PlayerHandle, type PlayerStatus, type RendererLike } from "../src/player/runtime";
import { parsePlayerParams, type QueryRecord } from "../src/player/time";
import { buildContractGlb, fixtureManifest, type FixtureOptions } from "./fixtures/contractFixture";

class FakeRenderer implements RendererLike {
  domElement = document.createElement("canvas");
  frames: Array<{ camera: string; position: number[] }> = [];
  pixelRatio = 0;
  size: [number, number] = [0, 0];
  clearColor: ColorRepresentation | null = null;
  disposed = false;
  contextLost = false;
  scene: Object3D | null = null;
  setPixelRatio(ratio: number) {
    this.pixelRatio = ratio;
  }
  setSize(width: number, height: number) {
    this.size = [width, height];
  }
  setClearColor(color: ColorRepresentation) {
    this.clearColor = color;
  }
  render(_scene: Object3D, camera: Camera) {
    this.scene = _scene;
    this.frames.push({
      camera: camera.name,
      position: camera
        .getWorldPosition(new Vector3())
        .toArray()
        .map((v) => +v.toFixed(6)),
    });
  }
  dispose() {
    this.disposed = true;
  }
  forceContextLoss() {
    this.contextLost = true;
  }
}

type Routes = Record<string, () => Response>;

const win = window;
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let nowMs = 0;
let reducedMotion = false;
let mediaQuery: MediaQueryList;

function installEnvironment(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      const route = routes[path];
      return route ? route() : new Response("not found", { status: 404, statusText: "Not Found" });
    }),
  );
  win.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafId += 1;
    rafQueue.set(rafId, cb);
    return rafId;
  };
  win.cancelAnimationFrame = (id: number) => {
    rafQueue.delete(id);
  };
  const mediaTarget = new EventTarget();
  Object.defineProperties(mediaTarget, {
    matches: { get: () => reducedMotion },
    media: { value: "(prefers-reduced-motion: reduce)" },
  });
  mediaQuery = mediaTarget as MediaQueryList;
  win.matchMedia = () => mediaQuery;
}

function runFrames(count = 1, stepMs = 16) {
  for (let i = 0; i < count; i++) {
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    nowMs += stepMs;
    for (const cb of callbacks) cb(nowMs);
  }
}

async function until(predicate: () => boolean, label: string) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    // Yield for asynchronous asset decoding; navigation itself uses simulated RAF.
    if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    runFrames();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function sceneRoutes(world: "samaritan" | "machine", fixture?: FixtureOptions, manifestOverrides = {}): Routes {
  return {
    [`/assets/${world}/manifest.json`]: () => Response.json(fixtureManifest(world, manifestOverrides)),
    [`/assets/${world}/${world}.glb`]: () => new Response(buildContractGlb(fixture)),
  };
}

it('disposes a late world result when the parallel opening request has failed',async()=>{
 installEnvironment(sceneRoutes('samaritan'));
 const originalFetch=globalThis.fetch;
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(new URL(url).pathname==='/assets/samaritan/samaritan.glb')await pending;
  return originalFetch(input,init);
 });
 const dispose=vi.spyOn(BufferGeometry.prototype,'dispose');
 const m=track(mount({},'samaritan',false,true));
 await until(()=>m.marker.dataset.state==='error','opening error without waiting for world');
 expect(m.rendererCreated()).toBe(false);
 release();await until(()=>dispose.mock.calls.length>0,'late world resource cleanup');
 expect(m.marker.dataset.state).toBe('error');expect(m.rendererCreated()).toBe(false);
});

interface Mounted {
  handle: PlayerHandle;
  host: HTMLElement;
  frame: HTMLElement;
  marker: HTMLElement;
  renderer: FakeRenderer;
  statuses: PlayerStatus[];
  openingStates: Array<{phase:string;command:string}>;
  rendererCreated: () => boolean;
}

function mount(query: QueryRecord, world: "samaritan" | "machine" = "samaritan", interactionReady = true, openingSequence: boolean | "straight" = false): Mounted {
  const host = document.createElement("main");
  Object.defineProperty(host, "clientWidth", { value: 1000, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 1000, configurable: true });
  const frame = document.createElement("div");
  const marker = document.createElement("div");
  host.append(marker, frame);
  document.body.append(host);
  const renderer = new FakeRenderer();
  let created = false;
  const statuses: PlayerStatus[] = [];
  const openingStates:Array<{phase:string;command:string}>=[];
  const handle = createPlayer({
    interactionReady, openingSequence, onOpening:state=>openingStates.push(state),
    world,
    params: parsePlayerParams(query),
    host,
    frame,
    marker,
    onStatus: (status) => statuses.push(status),
    createRenderer: () => {
      created = true;
      return renderer;
    },
  });
  return { handle, host, frame, marker, renderer, statuses, openingStates, rendererCreated: () => created };
}

function wheel(host: HTMLElement, deltaY: number) {
  host.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true }));
}

function key(name: string) {
  win.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

const mounted: Mounted[] = [];
function track(m: Mounted) {
  mounted.push(m);
  return m;
}

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  nowMs = 0;
  reducedMotion = false;
  window.history.replaceState(null, "", "http://localhost:3000/samaritan");
});

afterEach(() => {
  for (const m of mounted.splice(0)) {
    m.handle.dispose();
    m.host.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function captureStartupDeadline() {
  const timers = new Map<number, () => void>();
  let id = 100000;
  const originalSet = window.setTimeout.bind(window), originalClear = window.clearTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 45000) { timers.set(++id, callback as () => void); return id; }
    return originalSet(callback, delay, ...args);
  }) as typeof window.setTimeout);
  vi.spyOn(window, 'clearTimeout').mockImplementation((key) => { if(typeof key==='number')timers.delete(key); originalClear(key); });
  return {timers, expire(){const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());}};
}

it('times out a stalled manifest and rejects its late completion without creating a renderer', async () => {
  installEnvironment(sceneRoutes('samaritan'));
  const deadline=captureStartupDeadline();
  let release!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;})));
  const m=track(mount({}));
  deadline.expire();
  expect(m.statuses.at(-1)).toMatchObject({state:'error',message:'Scene asset loading stalled'});
  release(Response.json(fixtureManifest('samaritan')));
  await Promise.resolve();await Promise.resolve();runFrames();
  expect(m.marker.dataset.state).toBe('error');
  expect(m.rendererCreated()).toBe(false);
  expect(deadline.timers.size).toBe(0);
});

it('renews the idle deadline for real byte progress then disposes a late stalled GLB', async () => {
  installEnvironment(sceneRoutes('samaritan'));
  const deadline=captureStartupDeadline();
  const original=GLTFLoader.prototype.loadAsync;
  let progress!: (event:ProgressEvent)=>void, release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(function(this:GLTFLoader,url,onProgress){
    progress=onProgress!;
    return pending.then(()=>original.call(this,url));
  });
  const disposed=vi.spyOn(BufferGeometry.prototype,'dispose');
  const m=track(mount({}));
  await until(()=>Boolean(progress),'GLB requested');
  const first=[...deadline.timers.keys()][0]!;
  progress({loaded:100} as ProgressEvent);
  expect(deadline.timers.has(first)).toBe(false);
  const renewed=[...deadline.timers.keys()][0]!;
  progress({loaded:100} as ProgressEvent);
  expect(deadline.timers.has(renewed)).toBe(true); // Duplicate byte count cannot hide a stall.
  progress({loaded:Infinity} as ProgressEvent);progress({loaded:NaN} as ProgressEvent);
  expect(deadline.timers.has(renewed)).toBe(true); // Invalid byte counts are not progress.
  expect(m.marker.dataset.state).toBe('loading');
  deadline.expire();release();
  await until(()=>disposed.mock.calls.length>0,'late GLB disposed');
  expect(m.marker.dataset.state).toBe('error');expect(m.rendererCreated()).toBe(false);
});

it('disposes a late opening GLB after its timeout even when the world has completed', async () => {
  const routes=sceneRoutes('samaritan');
  routes['/assets/samaritan/opening-straight/opening-metadata.json']=()=>Response.json(
    JSON.parse(readFileSync('public/assets/samaritan/opening-straight/opening-metadata.json','utf8')));
  installEnvironment(routes);
  const deadline=captureStartupDeadline();
  const original=GLTFLoader.prototype.loadAsync;
  const geometry=new BufferGeometry(),lateScene=new Mesh(geometry);
  const dispose=vi.spyOn(geometry,'dispose');
  let worldDone=false,release!:()=>void,openingAbort:ReturnType<typeof vi.spyOn>|undefined;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(function(this:GLTFLoader,url,onProgress){
    if(url.includes('/opening-straight/')){
      openingAbort=vi.spyOn(this.manager,'abort');
      // Simulate a decoder that resolves after cancellation rather than rejecting.
      return pending.then(()=>({scene:lateScene} as unknown as Awaited<ReturnType<GLTFLoader['loadAsync']>>));
    }
    return original.call(this,url,onProgress).then(value=>{worldDone=true;return value;});
  });
  const m=track(mount({},'samaritan',false,'straight'));
  await until(()=>worldDone&&Boolean(openingAbort),'world complete and opening pending');
  expect(m.marker.dataset.state).toBe('loading');expect(m.rendererCreated()).toBe(false);
  deadline.expire();
  expect(openingAbort).toHaveBeenCalledTimes(1);
  expect(m.statuses.at(-1)).toMatchObject({state:'error',message:'Scene asset loading stalled'});
  release();await until(()=>dispose.mock.calls.length>0,'late opening geometry disposed');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(m.marker.dataset.state).toBe('error');expect(m.rendererCreated()).toBe(false);
  expect(m.openingStates).toHaveLength(0);expect(deadline.timers.size).toBe(0);
});

it('clears the download deadline before a hidden tab can defer presentation', async () => {
  installEnvironment(sceneRoutes('samaritan'));
  const deadline=captureStartupDeadline();
  const m=track(mount({}));
  // Hold RAF callbacks as a background tab does, while asset decoding completes.
  for(let i=0;i<100&&!m.rendererCreated();i++)await new Promise(resolve=>setTimeout(resolve,0));
  expect(m.rendererCreated()).toBe(true);
  expect(m.marker.dataset.state).toBe('loading');
  expect(deadline.timers.size).toBe(0);
  deadline.expire();runFrames();expect(m.marker.dataset.state).toBe('ready');
});

describe("honest unavailable states", () => {
  it("reports a missing asset bundle and never creates a renderer", async () => {
    installEnvironment({});
    const m = track(mount({ mode: "reference", t: "1" }));
    expect(m.marker.dataset.state).toBe("loading");
    await until(() => m.marker.dataset.state !== "loading", "terminal state");
    expect(m.marker.dataset.state).toBe("missing");
    expect(m.marker.dataset.time).toBe("");
    expect(m.statuses.at(-1)).toMatchObject({ state: "missing", message: "Scene asset bundle not present" });
    expect(m.rendererCreated()).toBe(false);
    expect(m.frame.querySelector("canvas")).toBeNull();
  });

  it("reports a missing GLB referenced by an otherwise valid manifest", async () => {
    const routes = sceneRoutes("machine");
    delete routes["/assets/machine/machine.glb"];
    installEnvironment(routes);
    const m = track(mount({}, "machine"));
    await until(() => m.marker.dataset.state !== "loading", "terminal state");
    expect(m.statuses.at(-1)).toMatchObject({ state: "missing", message: "Scene file not present" });
    expect(m.rendererCreated()).toBe(false);
  });

  it.each([
    ["contract violation", sceneRoutes("samaritan", undefined, { schemaVersion: 2 }), {}, "Manifest violates contract"],
    ["camera not animated", sceneRoutes("samaritan", { animateCamera: false }), {}, "Scene violates contract"],
    ["t beyond clip", sceneRoutes("samaritan"), { mode: "reference", t: "4.5" }, "Reference time outside clip"],
    ["malformed t", sceneRoutes("samaritan"), { mode: "reference", t: "soon" }, "Invalid player parameters"],
  ] as const)("reports %s as an error", async (_label, routes, query, message) => {
    installEnvironment(routes);
    const m = track(mount({ ...query }));
    await until(() => m.marker.dataset.state !== "loading", "terminal state");
    expect(m.marker.dataset.state).toBe("error");
    expect(m.statuses.at(-1)).toMatchObject({ state: "error", message });
    expect(m.frame.querySelector("canvas")).toBeNull();
  });
});

describe("reference mode", () => {
  it("renders the imported camera at exactly t and then marks ready", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({ mode: "reference", t: "1" }));
    await until(() => m.marker.dataset.state === "ready", "ready");
    expect(m.marker.dataset.time).toBe("1.000000");
    expect(m.renderer.frames.at(-1)).toEqual({ camera: "route_camera", position: [0, 1, 8] });
    expect(m.frame.querySelector("canvas")).toBe(m.renderer.domElement);
    // Source-aspect letterbox inside a 1000x1000 host.
    expect([m.frame.style.left, m.frame.style.top, m.frame.style.width, m.frame.style.height]).toEqual([
      "0px",
      "218px",
      "1000px",
      "563px",
    ]);
    expect(m.renderer.pixelRatio).toBeLessThanOrEqual(1.5);
  });

  it("ignores wheel and keys without explicit qa (capture stays frozen)", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({ mode: "reference", t: "2" }));
    await until(() => m.marker.dataset.state === "ready", "ready");
    const rendered = m.renderer.frames.length;
    wheel(m.host, 500);
    key("End");
    runFrames(10);
    expect(m.marker.dataset.time).toBe("2.000000");
    expect(m.renderer.frames.length).toBe(rendered);
    expect(rafQueue.size).toBe(0);
  });

  it("qa mode scrubs exactly without easing", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({ mode: "reference", t: "0", qa: "1" }));
    await until(() => m.marker.dataset.state === "ready", "ready");
    wheel(m.host, 6000); // 6000 / 24000 of a 4 s clip
    runFrames(1);
    expect(m.marker.dataset.time).toBe("1.000000");
    m.handle.controller.seek(3);
    runFrames(1);
    expect(m.renderer.frames.at(-1)).toEqual({ camera: "route_camera", position: [1, 1, 4] });
  });
});

describe("interactive mode", () => {
  it("wheel scrubs forward and reverse along the same authored path", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({}));
    await until(() => m.marker.dataset.state === "ready", "ready");
    expect(m.marker.dataset.time).toBe("0.000000");
    const start = m.renderer.frames.at(-1);

    wheel(m.host, 1750); // 1750 / 14000 of the 4 s clip
    await until(() => m.marker.dataset.settled === "true", "first half step");
    wheel(m.host, 1750); // 1750 / 14000 of the 4 s clip
    await until(() => m.marker.dataset.settled === "true" && m.marker.dataset.time === "1.000000", "settle at 1");
    expect(m.renderer.frames.at(-1)).toEqual({ camera: "route_camera", position: [0, 1, 8] });

    wheel(m.host, -1750);
    await until(() => m.marker.dataset.settled === "true", "first reverse step");
    wheel(m.host, -1750);
    await until(() => m.marker.dataset.settled === "true" && m.marker.dataset.time === "0.000000", "settle at 0");
    expect(m.renderer.frames.at(-1)).toEqual(start);
    expect(rafQueue.size).toBe(0); // settled: no further frame work
  });

  it("keys jump to clip ends; space plays forward on elapsed time", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({}));
    await until(() => m.marker.dataset.state === "ready", "ready");
    key("End");
    await until(() => m.marker.dataset.time === "4.000000", "end");
    expect(m.renderer.frames.at(-1)?.position).toEqual([2, 1, 2]);
    key("Home");
    await until(() => m.marker.dataset.time === "0.000000" && m.marker.dataset.settled === "true", "start");
    key(" ");
    expect(m.marker.dataset.playing).toBe("true");
    runFrames(31, 16); // first frame primes the clock; 30 * 16 ms afterwards
    expect(Number(m.marker.dataset.time)).toBeCloseTo(0.48, 6);
    key(" ");
    expect(m.marker.dataset.playing).toBe("false");
  });

  it("autoplay is opt-in and suppressed by reduced motion", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const plain = track(mount({}));
    await until(() => plain.marker.dataset.state === "ready", "ready");
    expect(plain.marker.dataset.playing).toBe("false");

    reducedMotion = true;
    const reduced = track(mount({ autoplay: "1" }));
    await until(() => reduced.marker.dataset.state === "ready", "ready");
    expect(reduced.marker.dataset.playing).toBe("false");

    reducedMotion = false;
    const auto = track(mount({ autoplay: "1" }));
    await until(() => auto.marker.dataset.state === "ready", "ready");
    expect(auto.marker.dataset.playing).toBe("true");
  });

  it("does not schedule frames while the document is hidden", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = track(mount({}));
    await until(() => m.marker.dataset.state === "ready", "ready");
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      wheel(m.host, 800);
      expect(rafQueue.size).toBe(0);
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
    }
    document.dispatchEvent(new Event("visibilitychange"));
    expect(rafQueue.size).toBe(0);
  });
});

describe("cleanup", () => {
  it("removes every listener and releases the renderer on dispose", async () => {
    const added = new Map<EventTarget, number>();
    const bump = (target: EventTarget, n: number) => added.set(target, (added.get(target) ?? 0) + n);
    for (const target of [window, document] as EventTarget[]) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation((...args: Parameters<EventTarget["addEventListener"]>) => {
        bump(target, 1);
        add(...args);
      });
      vi.spyOn(target, "removeEventListener").mockImplementation(
        (...args: Parameters<EventTarget["removeEventListener"]>) => {
          bump(target, -1);
          remove(...args);
        },
      );
    }
    installEnvironment(sceneRoutes("samaritan"));
    const m = mount({});
    await until(() => m.marker.dataset.state === "ready", "ready");
    expect(added.get(window)).toBeGreaterThan(0);
    wheel(m.host, 400);
    m.handle.dispose();
    m.host.remove();
    expect(added.get(window)).toBe(0);
    expect(added.get(document)).toBe(0);
    expect(m.renderer.disposed).toBe(true);
    expect(m.renderer.contextLost).toBe(true);
    expect(m.frame.querySelector("canvas")).toBeNull();
    expect(rafQueue.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("discards a scene that finishes loading after dispose", async () => {
    installEnvironment(sceneRoutes("samaritan"));
    const m = mount({});
    m.handle.dispose();
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.rendererCreated()).toBe(false);
    expect(m.marker.dataset.state).toBe("loading");
  });
});

describe('opening interaction barrier', () => {
  it('defers autoplay exactly once and ignores seek until release', async () => {
    installEnvironment(sceneRoutes('samaritan'));
    const m = track(mount({ autoplay: '1', t: '1' }, 'samaritan', false));
    await until(() => m.marker.dataset.state === 'ready', 'ready');
    runFrames(10);
    expect(m.handle.controller.getSnapshot()).toMatchObject({ time: 1, playing: false });
    m.handle.controller.seek(2);
    runFrames(2);
    expect(m.handle.controller.getSnapshot()?.time).toBe(1);
    m.handle.controller.setInteractionReady();
    expect(m.handle.controller.getSnapshot()?.playing).toBe(true);
    m.handle.controller.setInteractionReady();
    expect(m.handle.controller.getSnapshot()?.playing).toBe(true);
  });
  it('release respects reduced motion and disposal', async () => {
    reducedMotion = true;
    installEnvironment(sceneRoutes('samaritan'));
    const m = track(mount({ autoplay: '1' }, 'samaritan', false));
    await until(() => m.marker.dataset.state === 'ready', 'ready');
    m.handle.controller.setInteractionReady();
    expect(m.handle.controller.getSnapshot()?.playing).toBe(false);
    m.handle.dispose();
    m.handle.controller.setInteractionReady();
    expect(m.handle.controller.getSnapshot()).toBeNull();
  });
  it('ignores held touch through release until a fresh pointerdown', async () => {
    installEnvironment(sceneRoutes('samaritan'));
    const m = track(mount({}, 'samaritan', false));
    await until(() => m.marker.dataset.state === 'ready', 'ready');
    const pointer = (type: string, y: number) => {
      const event = new Event(type);
      Object.assign(event, {pointerType:'touch', pointerId:1, clientY:y});
      m.host.dispatchEvent(event);
    };
    pointer('pointerdown',500); pointer('pointermove',300);
    m.handle.controller.setInteractionReady(); pointer('pointermove',100);
    expect(m.handle.controller.getSnapshot()?.targetTime).toBe(0);
    pointer('pointerdown',500); pointer('pointermove',400);
    expect(m.handle.controller.getSnapshot()!.targetTime).toBeGreaterThan(0);
    pointer('pointermove',500);
    expect(m.handle.controller.getSnapshot()?.targetTime).toBe(0);
  });
});

describe('first-frame failures remain visible instead of hanging startup', () => {
  it('reports initial render errors even when WebGL construction succeeds', async () => {
    installEnvironment(sceneRoutes('samaritan'));
    const m = track(mount({}, 'samaritan', false));
    m.renderer.render = () => { throw new Error('first frame rejected'); };
    await until(() => m.marker.dataset.state === 'error', 'render error');
    expect(m.statuses.at(-1)).toMatchObject({state:'error', message:'Scene initialization failed', detail:'first frame rejected'});
    expect(m.frame.querySelector('canvas')).toBeNull();
  });
  it('reaches ready before interaction release and reports context loss', async () => {
    installEnvironment(sceneRoutes('samaritan'));
    const m = track(mount({}, 'samaritan', false));
    await until(() => m.marker.dataset.state === 'ready', 'ready while startup held');
    expect(m.marker.dataset.stage).toBe('ready');
    m.renderer.domElement.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
    expect(m.marker.dataset.state).toBe('error');
    expect(m.statuses.at(-1)).toMatchObject({message:'Graphics connection lost'});
  });
});



it('integrates actual selected rails with intro release, hidden pause, reverse seek and reduced motion', async()=>{
 const nativeFetch=globalThis.fetch;
 const bytes=readFileSync('public/assets/samaritan/scene.glb');
 const manifest=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));
 vi.stubGlobal('self',globalThis);vi.stubGlobal('URL',NodeURL);vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close(){}}));
 installEnvironment({
   '/assets/samaritan/manifest.json':()=>Response.json(manifest),
   '/assets/samaritan/scene.glb':()=>new Response(bytes),
 });
 const routedFetch=globalThis.fetch;
 vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('blob:')?nativeFetch(input,init):routedFetch(input,init));
 const m=track(mount({},'samaritan',false));
 await until(()=>m.marker.dataset.state==='ready','actual world ready');
 expect(m.marker.dataset.ambientRails).toBe('14');
 const rail=m.renderer.scene!.getObjectByName('strip_072_b2')!;
 let cell:Mesh|null=null;
 rail.traverse(n=>{if(n instanceof Mesh&&!Array.isArray(n.material)&&n.material.name==='mat_field_cell_b2')cell=n;});
 const selected=cell as unknown as Mesh;expect(selected).not.toBeNull();
 const base=selected.position.y;
 runFrames(120,16);expect(selected.position.y).toBe(base); // title barrier still held
 m.handle.controller.setInteractionReady();runFrames(120,16);
 expect(m.handle.controller.getSnapshot()?.time).toBe(0);
 expect(selected.position.y).not.toBe(base);
 m.handle.controller.seek(0);runFrames(1,0); // flush pending 30Hz presentation at the same clock
 const beforeSeek=selected.position.y;
 m.handle.controller.seek(21.16);runFrames(1,0);
 m.handle.controller.seek(0);runFrames(1,0);
 expect(selected.position.y).toBe(beforeSeek); // no clip-derived drift
 Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,30000);expect(selected.position.y).toBe(beforeSeek);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,16);expect(selected.position.y).toBe(beforeSeek); // no hidden catch-up
 reducedMotion=true;mediaQuery.dispatchEvent(new Event('change'));runFrames(1,16);
 expect(selected.position.y).toBe(base);runFrames(120,16);expect(selected.position.y).toBe(base);
 reducedMotion=false;mediaQuery.dispatchEvent(new Event('change'));runFrames(1,16);
 expect(selected.position.y).toBe(base);runFrames(120,16);expect(selected.position.y).not.toBe(base);
 expect(m.handle.controller.getSnapshot()?.time).toBe(0);
});

it('maps admitted manual holds while playback and exact seeks retain authored time',async()=>{
 const world='samaritan';
 const nativeFetch=globalThis.fetch;
 const manifest=JSON.parse(readFileSync('public/assets/'+world+'/manifest.json','utf8'));
 const scenePath='/assets/'+world+'/'+manifest.sceneUrl.replace(/^\.\//,'');
 const bytes=readFileSync('public'+scenePath);
 vi.stubGlobal('self',globalThis);vi.stubGlobal('URL',NodeURL);vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close(){}}));
 installEnvironment({['/assets/'+world+'/manifest.json']:()=>Response.json(manifest),[scenePath]:()=>new Response(bytes)});
 const routedFetch=globalThis.fetch;
 vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('blob:')?nativeFetch(input,init):routedFetch(input,init));
 const m=track(mount({},world));
 await until(()=>m.marker.dataset.state==='ready','actual admitted route ready');
 const hold=manifest.anchors[0],mid=(hold.holdStart+hold.holdEnd)/2;
 m.handle.controller.seek(mid);runFrames(1,0);
 const position=m.renderer.frames.at(-1)!.position;
 m.handle.controller.togglePlay();runFrames(2,100);
 const afterPlayback=m.handle.controller.getSnapshot()!.time;
 expect(afterPlayback).toBeGreaterThan(mid);expect(afterPlayback-mid).toBeLessThanOrEqual(.201);
 expect(m.renderer.frames.at(-1)!.position).toEqual(position);
 wheel(m.host,100);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.playing).toBe(false);
 const forward=m.handle.controller.getSnapshot()!.time;
 expect(forward).toBeGreaterThan(hold.holdEnd); // 100px crosses, old ~800px hold cannot
 wheel(m.host,-100);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.time).toBeCloseTo(hold.holdEnd,5); // reverse entry consumes old backlog
 runFrames(120,16);expect(m.handle.controller.getSnapshot()!.time).toBeCloseTo(hold.holdEnd,5);
 wheel(m.host,-10);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.time).toBeLessThan(hold.holdEnd);
 expect(m.handle.controller.getSnapshot()!.time).toBeGreaterThan(hold.holdStart);
 expect(m.renderer.frames.at(-1)!.position).toEqual(position);
 m.handle.controller.seek(mid);runFrames(1,0);
 expect(m.handle.controller.getSnapshot()!.time).toBe(mid);
 m.handle.controller.seek(hold.holdStart-.05);runFrames(1,0);
 wheel(m.host,1000);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.time).toBe(hold.holdStart);
 expect(m.handle.controller.getSnapshot()!.settled).toBe(true);
 runFrames(120,16);expect(m.handle.controller.getSnapshot()!.time).toBe(hold.holdStart);
 wheel(m.host,100);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.time).toBeGreaterThan(hold.holdEnd);
 // Releasing held input inside a photo cancels pending travel immediately.
 m.handle.controller.seek(mid);runFrames(1,0);
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));runFrames(2,16);
 window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}));
 const released=m.handle.controller.getSnapshot()!.time;runFrames(120,16);
 expect(m.handle.controller.getSnapshot()!.time).toBe(released);
 expect(released).toBeGreaterThanOrEqual(hold.holdStart);expect(released).toBeLessThan(hold.holdEnd);
 // Continuous held input deliberately traverses; OS repeat frequency adds nothing.
 const heldTravel=(repeat:boolean)=>{
   m.handle.controller.seek(hold.holdStart-.05);runFrames(1,0);
   window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
   for(let i=0;i<90;i++){if(repeat)window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',repeat:true}));runFrames(1,16);}
   const result=m.handle.controller.getSnapshot()!.time;
   window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}));return result;
 };
 const held=heldTravel(false);expect(held).toBeGreaterThan(hold.holdEnd);
 expect(heldTravel(true)).toBeCloseTo(held,8);

 // Home/End traverse all admitted holds smoothly, including key release inside a hold.
 m.handle.controller.seek(mid);runFrames(1,0);
 key('End');window.dispatchEvent(new KeyboardEvent('keyup',{key:'End'}));
 runFrames(3,16);expect(m.handle.controller.getSnapshot()!.time).toBeLessThan(manifest.durationSeconds);
 runFrames(900,100);expect(m.handle.controller.getSnapshot()!.time).toBe(m.handle.controller.getSnapshot()!.duration);
 expect(m.handle.controller.getSnapshot()!.settled).toBe(true);
 key('Home');window.dispatchEvent(new KeyboardEvent('keyup',{key:'Home'}));
 runFrames(900,100);expect(m.handle.controller.getSnapshot()!.time).toBe(0);
 // Fresh wheel intent interrupts endpoint travel and restores the ordinary photo guard.
 m.handle.controller.seek(hold.holdStart-.05);runFrames(1,0);key('End');
 wheel(m.host,1000);runFrames(300,16);
 expect(m.handle.controller.getSnapshot()!.time).toBe(hold.holdStart);
 expect(m.handle.controller.getSnapshot()!.settled).toBe(true);
});

it('integrates real opening into one clock with early input/hidden guards and same-pose handoff',async()=>{
 const paint=vi.fn();
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillText:paint} as unknown as CanvasRenderingContext2D);
 let openingRequested=false;let decodeStarted=false,releaseDecode!:()=>void;const decodeGate=new Promise<void>(resolve=>{releaseDecode=resolve;});
 const nativeFetch=globalThis.fetch;
 const manifest=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));
 const worldBytes=readFileSync('public/assets/samaritan/scene.glb');
 const openingBytes=readFileSync('public/assets/samaritan/opening/samaritan-opening.glb');
 const metadata=JSON.parse(readFileSync('public/assets/samaritan/opening/opening-metadata.json','utf8'));
 vi.stubGlobal('self',globalThis);vi.stubGlobal('URL',NodeURL);vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('createImageBitmap',async()=>{decodeStarted=true;await decodeGate;return {width:1,height:1,close(){}};});
 installEnvironment({'/assets/samaritan/manifest.json':()=>Response.json(manifest),'/assets/samaritan/scene.glb':()=>new Response(worldBytes),'/assets/samaritan/opening/opening-metadata.json':()=>{openingRequested=true;return Response.json(metadata)},'/assets/samaritan/opening/samaritan-opening.glb':()=>new Response(openingBytes)});
 const routedFetch=globalThis.fetch;vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('blob:')?nativeFetch(input,init):routedFetch(input,init));
 const m=track(mount({},'samaritan',false,true));
 await until(()=>decodeStarted,'real image decode pending');expect(openingRequested).toBe(true);runFrames(120,100);
 expect(m.marker.dataset.state).not.toBe('ready');expect(m.openingStates).toHaveLength(0);
 releaseDecode();await until(()=>m.marker.dataset.state==='ready','both real bundles ready');
 const first=m.renderer.frames[0]!.position;
 expect(m.openingStates.at(-1)!.phase).toBe('connection');
 Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));runFrames(1,30000);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));runFrames(1,100);
 expect(m.openingStates.at(-1)!.phase).toBe('connection');
 const vignette=m.renderer.scene!.getObjectByName('fx_vignette') as Mesh;
 const vignetteOpacity=()=>Array.isArray(vignette.material)?NaN:vignette.material.opacity;
 expect(vignetteOpacity()).toBe(1);
 const pane=m.renderer.scene!.getObjectByName('screen_01') as Mesh;
 const geometry=pane.geometry,originalUv=Array.from(geometry.getAttribute('uv').array),originalMaterial=pane.material;
 wheel(m.host,3000);m.handle.controller.seek(20);m.handle.controller.setInteractionReady();
 expect(m.handle.controller.getSnapshot()!.targetTime).toBe(0);
 runFrames(45,100);expect(m.openingStates.at(-1)!.phase).toBe('world');
 expect(vignetteOpacity()).toBeGreaterThan(0);expect(vignetteOpacity()).toBeLessThan(1);
 expect(paint).toHaveBeenCalledWith('WHAT',1024,588); // appears on approaching pane before fullscreen
 runFrames(25,100);expect(m.openingStates.at(-1)!.phase).toBe('commands');expect(vignetteOpacity()).toBe(0);
 expect(pane.geometry).toBe(geometry);expect(Array.from(geometry.getAttribute('uv').array)).toEqual(originalUv);
 expect(pane.material).not.toBe(originalMaterial);expect(paint).toHaveBeenCalledWith('WHAT',1024,588);
 const commandMaterial=pane.material;
 const focus=m.renderer.frames.at(-1)!.position;
 Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,30000);expect(m.openingStates.at(-1)!.phase).toBe('commands');expect(m.renderer.frames.at(-1)!.position).toEqual(focus);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,100);expect(m.renderer.frames.at(-1)!.position).toEqual(focus);
 for(let i=0;i<40&&m.openingStates.at(-1)!.phase!=='return';i++)runFrames(1,100);
 expect(m.openingStates.at(-1)!.phase).toBe('return');expect(pane.material).toBe(commandMaterial);expect(vignetteOpacity()).toBe(0);
 runFrames(10,100);expect(vignetteOpacity()).toBeGreaterThan(0);expect(vignetteOpacity()).toBeLessThan(1);
 runFrames(80,100);expect(m.openingStates.at(-1)!.phase).toBe('complete');
 expect(m.openingStates.filter(x=>x.phase==='complete')).toHaveLength(1);
 expect(m.renderer.frames.at(-1)!.position).toEqual(first);
 expect(m.handle.controller.getSnapshot()!.time).toBe(0);
 wheel(m.host,100);runFrames(120,16);expect(m.handle.controller.getSnapshot()!.time).toBeGreaterThan(0);
});

it('integrates straight opening into one clock with early input/hidden guards and same-pose handoff',async()=>{
 const paint=vi.fn();
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillText:paint,measureText:(text:string)=>({width:text.length*29})} as unknown as CanvasRenderingContext2D);
 let openingRequested=false;let decodeStarted=false,releaseDecode!:()=>void;const decodeGate=new Promise<void>(resolve=>{releaseDecode=resolve;});
 const nativeFetch=globalThis.fetch;
 const manifest=JSON.parse(readFileSync('public/assets/samaritan/manifest.json','utf8'));
 const worldBytes=readFileSync('public/assets/samaritan/scene.glb');
 const openingBytes=readFileSync('public/assets/samaritan/opening-straight/samaritan-opening.glb');
 const metadata=JSON.parse(readFileSync('public/assets/samaritan/opening-straight/opening-metadata.json','utf8'));
 vi.stubGlobal('self',globalThis);vi.stubGlobal('URL',NodeURL);vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('createImageBitmap',async()=>{decodeStarted=true;await decodeGate;return {width:1,height:1,close(){}};});
 installEnvironment({'/assets/samaritan/manifest.json':()=>Response.json(manifest),'/assets/samaritan/scene.glb':()=>new Response(worldBytes),'/assets/samaritan/opening-straight/opening-metadata.json':()=>{openingRequested=true;return Response.json(metadata)},'/assets/samaritan/opening-straight/samaritan-opening.glb':()=>new Response(openingBytes)});
 const routedFetch=globalThis.fetch;vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>String(input).startsWith('blob:')?nativeFetch(input,init):routedFetch(input,init));
 const m=track(mount({},'samaritan',false,'straight'));
 await until(()=>decodeStarted,'real image decode pending');expect(openingRequested).toBe(true);runFrames(120,100);
 expect(m.marker.dataset.state).not.toBe('ready');expect(m.openingStates).toHaveLength(0);
 releaseDecode();await until(()=>m.marker.dataset.state==='ready','both real bundles ready');
 const first=m.renderer.frames[0]!.position;
 expect(m.openingStates.at(-1)!.phase).toBe('connection');
 Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));runFrames(1,30000);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));runFrames(1,100);
 expect(m.openingStates.at(-1)!.phase).toBe('connection');
 const vignette=m.renderer.scene!.getObjectByName('fx_vignette') as Mesh;
 const vignetteOpacity=()=>Array.isArray(vignette.material)?NaN:vignette.material.opacity;
 expect(vignetteOpacity()).toBe(0);
 const pane=m.renderer.scene!.getObjectByName('focal_screen') as Mesh;
 const geometry=pane.geometry,originalUv=Array.from(geometry.getAttribute('uv').array),originalMaterial=pane.material;
 wheel(m.host,3000);m.handle.controller.seek(20);m.handle.controller.setInteractionReady();
 expect(m.handle.controller.getSnapshot()!.targetTime).toBe(0);
 expect((pane.material as unknown as {map:{isCanvasTexture:boolean}}).map.isCanvasTexture).toBe(true); // Symbol replaces photo before approach.
 runFrames(25,100);expect(m.openingStates.at(-1)!.phase).toBe('world');
 expect(vignetteOpacity()).toBe(0); // white opening edges throughout travel, normal-world material is separate
 expect(paint).not.toHaveBeenCalled(); // Triangle-only surface is already present; words start at full coverage.
 for(let i=0;i<Math.ceil(metadata.phases.approach.end/.112)+5&&m.openingStates.at(-1)!.phase!=='commands';i++)runFrames(1,100);expect(m.openingStates.at(-1)!.phase).toBe('commands');expect(vignetteOpacity()).toBe(0);
 expect(pane.geometry).toBe(geometry);expect(Array.from(geometry.getAttribute('uv').array)).toEqual(originalUv);
 expect(pane.material).toBe(originalMaterial);expect(paint).toHaveBeenCalled(); // Same surface, no photo-to-command material swap.
 const commandMaterial=pane.material;
 const focus=m.renderer.frames.at(-1)!.position;
 Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,30000);expect(m.openingStates.at(-1)!.phase).toBe('commands');expect(m.renderer.frames.at(-1)!.position).toEqual(focus);
 Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));
 runFrames(1,100);expect(m.renderer.frames.at(-1)!.position).toEqual(focus);
 for(let i=0;i<40&&m.openingStates.at(-1)!.phase!=='return';i++)runFrames(1,100);
 expect(m.openingStates.at(-1)!.phase).toBe('return');expect(pane.material).toBe(commandMaterial);expect(vignetteOpacity()).toBe(0);
 const frozenSize=[...m.renderer.size];
 Object.defineProperty(m.host,'clientWidth',{value:390,configurable:true});
 Object.defineProperty(m.host,'clientHeight',{value:844,configurable:true});
 window.dispatchEvent(new Event('resize'));
 expect(m.renderer.size).toEqual(frozenSize);
 const presentation=m.host.children[1] as HTMLElement;
 expect(parseFloat(presentation.style.width)).toBeGreaterThanOrEqual(390);
 expect(parseFloat(presentation.style.height)).toBeGreaterThanOrEqual(844);
 const frozenCount=m.renderer.frames.length;runFrames(2,100);expect(m.renderer.frames).toHaveLength(frozenCount);expect(m.renderer.frames.at(-1)!.position).toEqual(focus);
 runFrames(80,100);expect(m.openingStates.at(-1)!.phase).toBe('complete');
 expect(m.openingStates.filter(x=>x.phase==='complete')).toHaveLength(1);
 expect(m.renderer.frames.at(-1)!.position).toEqual([0,0,0]);expect(first).not.toEqual([0,0,0]);
 expect(m.handle.controller.getSnapshot()!.time).toBe(0);
 wheel(m.host,100);runFrames(120,16);expect(m.handle.controller.getSnapshot()!.time).toBeGreaterThan(0);
});
