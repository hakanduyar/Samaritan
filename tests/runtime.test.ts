// @vitest-environment jsdom
import { Mesh, Vector3, type Camera, type ColorRepresentation, type Object3D } from "three";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

interface Mounted {
  handle: PlayerHandle;
  host: HTMLElement;
  frame: HTMLElement;
  marker: HTMLElement;
  renderer: FakeRenderer;
  statuses: PlayerStatus[];
  rendererCreated: () => boolean;
}

function mount(query: QueryRecord, world: "samaritan" | "machine" = "samaritan", interactionReady = true): Mounted {
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
  const handle = createPlayer({
    interactionReady,
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
  return { handle, host, frame, marker, renderer, statuses, rendererCreated: () => created };
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

    wheel(m.host, 3000);
    await until(() => m.marker.dataset.settled === "true", "first half step");
    wheel(m.host, 3000);
    await until(() => m.marker.dataset.settled === "true" && m.marker.dataset.time === "1.000000", "settle at 1");
    expect(m.renderer.frames.at(-1)).toEqual({ camera: "route_camera", position: [0, 1, 8] });

    wheel(m.host, -3000);
    await until(() => m.marker.dataset.settled === "true", "first reverse step");
    wheel(m.host, -3000);
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
 expect(m.marker.dataset.ambientRails).toBe('8');
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
 expect(m.handle.controller.getSnapshot()!.time).toBeCloseTo(afterPlayback,5);
 expect(m.renderer.frames.at(-1)!.position).toEqual(position);
 m.handle.controller.seek(mid);runFrames(1,0);
 expect(m.handle.controller.getSnapshot()!.time).toBe(mid);
});
