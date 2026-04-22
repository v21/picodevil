import { silence } from "@strudel/core";
import "./visual-controls";
import { setupEditor } from "./editor";
import "./shuffle-stack";
import { CYCLES_PER_SECOND, setRuntimeCps, MAX_FREE_VIDEO_ELEMENTS, MAX_BLOB_CACHE_BYTES } from "./config";
import { resolveMedia, addMedia, clearAll as clearMediaRegistry, setDurationByUrl, loadVideo, loadImage, getAllEntries, initRegistry, addOnChange } from "./media-registry";
import { loadFromUrl, saveToUrl, setUrlWarnCallback } from "./url-state";
import { defaultCode } from "./editor";
import { isNativeRate } from "./playback-rate";
import { createVideoPoolManager } from "./video-pool-manager";
import { transpile, type WidgetCallInfo } from "./transpiler";
import { runTranspiled } from "./eval-sandbox";
import { slider as sliderWidget, resetWidgetCounter } from "./widgets";
import { warn, flushWarnings, clearWarnings } from "./warnings";
import { setupSidebar } from "./sidebar";
import { loadCamera, loadScreen } from "./stream-manager";
import { Canvas2DRenderer } from "./canvas2d-renderer";
import { WebGLRenderer } from "./webgl-renderer";
import { FrameRenderer } from "./renderer";
import type { Renderer } from "./renderer-interface";


const canvas = document.getElementById("c") as HTMLCanvasElement;

const useWebGL = new URLSearchParams(location.search).get('renderer') !== 'canvas2d';
let activeRenderer: Renderer;
if (useWebGL) {
  try {
    activeRenderer = new WebGLRenderer(canvas);
  } catch (e) {
    console.warn('WebGL2 unavailable, falling back to Canvas 2D:', e);
    activeRenderer = new Canvas2DRenderer(canvas.getContext("2d")!);
  }
} else {
  activeRenderer = new Canvas2DRenderer(canvas.getContext("2d")!);
}

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  activeRenderer.resize(canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

// --- state ---
/** A screen is anything with queryArc — ScreenPattern subclasses or plain Patterns. */
type Screen = { queryArc(begin: number, end: number): any[] };
let screens: Screen[] = [];
let cyclesPerSecond = CYCLES_PER_SECOND;
let cpsPattern: Pattern | null = null;
let accumulatedCycle = 0;
let lastFrameSec = 0;

// --- $: label system ---
let pPatterns: Record<string, Screen> = {};
let anonymousIndex = 0;

/** Inject .p() onto Pattern.prototype. */
import { Pattern, useRNG } from "@strudel/core";
useRNG('precise');
(Pattern.prototype as any).p = function (id: string) {
  if (id.startsWith('_') || id.endsWith('_')) return this;
  if (id.includes('$')) {
    id = `${id}${anonymousIndex}`;
    anonymousIndex++;
  }
  pPatterns[id] = this;
  return this;
};

function collectScreens(): Screen[] {
  const patterns: Screen[] = [];
  let soloActive = false;

  for (const [key, pat] of Object.entries(pPatterns)) {
    const isSoloed = key.length > 1 && key.startsWith('S');
    if (isSoloed && !soloActive) {
      patterns.length = 0;
      soloActive = true;
    }
    if (!soloActive || isSoloed) {
      patterns.push(pat);
    }
  }

  return patterns;
}

// --- performance metrics (exposed for stress testing) ---
const uzuMetrics = {
  frameTimes: [] as number[],
  interFrameTimes: [] as number[],
  heapSamples: [] as number[],
  seekCount: 0,
  poolSize: 0,
  freePoolSize: 0,
  shareHits: 0,
  maxFrameTime: 0,
  maxInterFrameTime: 0,
  xLog: [] as number[],
  naturalCount: 0,
  seekModeCount: 0,
  screensCount: 0,
  eventsPerFrame: 0,
  seeksThisFrame: 0,
  driftSeeksThisFrame: 0,
  seeksHistory: [] as number[],
  driftSeeksHistory: [] as number[],
  /** Per-phase rolling frame times (ms, last 300 frames). */
  phaseQuery: [] as number[],
  phaseAssign: [] as number[],
  phaseDraw: [] as number[],
  phasePrewarm: [] as number[],
  reset() {
    this.frameTimes = [];
    this.interFrameTimes = [];
    this.heapSamples = [];
    this.seekCount = 0;
    this.shareHits = 0;
    this.maxFrameTime = 0;
    this.maxInterFrameTime = 0;
    this.xLog = [];
    this.phaseQuery = [];
    this.phaseAssign = [];
    this.phaseDraw = [];
    this.phasePrewarm = [];
  },
};
(window as any).uzuMetrics = uzuMetrics;
(window as any).uzuPerfInfo = () => {
  let blobCacheBytes = 0;
  for (const s of pool.videoBlobSizes.values()) blobCacheBytes += s;
  return {
    naturalCount: uzuMetrics.naturalCount,
    seekCount: uzuMetrics.seekModeCount,
    screensCount: uzuMetrics.screensCount,
    eventsPerFrame: uzuMetrics.eventsPerFrame,
    seeksThisFrame: uzuMetrics.seeksThisFrame,
    seeksPer300f: uzuMetrics.seeksHistory.reduce((a, b) => a + b, 0),
    driftSeeksPer300f: uzuMetrics.driftSeeksHistory.reduce((a, b) => a + b, 0),
    blobCacheBytes,
    blobCacheCount: pool.videoBlobUrls.size,
  };
};

// --- video pool ---
const pool = createVideoPoolManager({
  resolveMediaUrl: (name, base) => {
    const entry = resolveMedia(name);
    return entry ? entry.url : base + name;
  },
  onDurationDiscovered: (srcUrl, duration) => {
    setDurationByUrl(srcUrl, duration);
  },
  createElement: () => {
    const el = document.createElement("video");
    el.crossOrigin = "anonymous";
    return el;
  },
  maxFreeTotal: MAX_FREE_VIDEO_ELEMENTS,
  maxBlobBytes: MAX_BLOB_CACHE_BYTES,
});

const frameRenderer = new FrameRenderer(activeRenderer, pool, uzuMetrics);

/**
 * Sets the global cycles per second (tempo). Default is 0.5 (one cycle = 2 seconds).
 *
 * @param {number} cps cycles per second
 * @example
 * setCps(1)   // one cycle per second
 * setCps(0.25) // one cycle every 4 seconds
 *
 */
function setCps(cps: number | Pattern) {
  if (typeof cps === "number") {
    if (cps === 0) {
      // Freeze at current cycle position
      const nowSec = (performance.now() - startTime) / 1000;
      accumulatedCycle = nowSec * cyclesPerSecond;
      cyclesPerSecond = 0;
      cpsPattern = null;
      return;
    }
    const nowSec = (performance.now() - startTime) / 1000;
    const currentCycle = nowSec * cyclesPerSecond;
    startTime = performance.now() - (currentCycle / cps) * 1000;
    cyclesPerSecond = cps;
    cpsPattern = null;
  } else {
    cpsPattern = cps;
  }
}

function setCpm(cpm: number | Pattern) {
  if (typeof cpm === "number") {
    setCps(cpm / 60);
  } else {
    setCps(cpm.fmap((v: number) => v / 60));
  }
}

function hush() {
  screens = [];
  pPatterns = {};
  anonymousIndex = 0;
  return silence;
}


// Expose media registry for monkey tester
(window as any).uzuAddMedia = addMedia;
(window as any).uzuClearMedia = clearMediaRegistry;

// called from editor on ctrl+enter
window.uzuEval = (code: string): { error: string | null; widgets: WidgetCallInfo[] } => {
  // Phase 1: Transpile — if this fails, don't touch running state at all
  let transpiled: string;
  let widgets: WidgetCallInfo[] = [];
  try {
    const result = transpile(code);
    transpiled = result.code;
    widgets = result.widgets;
  } catch (e) {
    console.error("transpile error:", e);
    return { error: e instanceof Error ? e.message : String(e), widgets: [] };
  }

  // Phase 2: Snapshot current state so we can restore on execution failure
  const prevScreens = [...screens];
  const prevPPatterns = { ...pPatterns };
  const prevAnonymousIndex = anonymousIndex;
  const prevCpsPattern = cpsPattern;
  const prevCyclesPerSecond = cyclesPerSecond;

  // Phase 3: Clear state and execute
  pool.clearVideos(frameRenderer.activeVideoEls.splice(0));
  clearWarnings();
  if (typeof window !== "undefined") (window as any).uzuWarnings = [];
  screens = [];
  pPatterns = {};
  anonymousIndex = 0;
  cpsPattern = null;
  resetWidgetCounter();
  try {
    runTranspiled(transpiled, {
      setCps, setCpm, setcps: setCps, setcpm: setCpm,
      hush, loadVideo, loadImage, loadCamera, loadScreen,
      slider: sliderWidget,
    });
    // Collect $: registered patterns
    const pScreens = collectScreens();
    if (pScreens.length > 0) {
      screens = [...screens, ...pScreens];
    }
    // Prewarm all screens
    for (const s of screens) frameRenderer.prewarmBlobs(s);
    console.log("evaluated:", code, "screens:", screens.length);
    return { error: null, widgets };
  } catch (e) {
    // Execution failed — restore previous state so old visuals keep rendering
    console.error("eval error:", e);
    screens = prevScreens;
    pPatterns = prevPPatterns;
    anonymousIndex = prevAnonymousIndex;
    cpsPattern = prevCpsPattern;
    cyclesPerSecond = prevCyclesPerSecond;
    return { error: e instanceof Error ? e.message : String(e), widgets };
  }
};

// --- render loop ---
let startTime = performance.now();
let lastRafAbsTime = performance.now();

// Expose active video elements for testing/debugging
(window as any)._uzuActiveVideoEls = frameRenderer.activeVideoEls;

function frame() {
  const rafAbsNow = performance.now();
  const interFrameGap = rafAbsNow - lastRafAbsTime;
  lastRafAbsTime = rafAbsNow;
  const now = rafAbsNow - startTime;
  const nowSec = now / 1000;
  const deltaSec = nowSec - lastFrameSec;
  lastFrameSec = nowSec;

  let cps = cyclesPerSecond;
  if (cpsPattern) {
    const haps = cpsPattern.queryArc(accumulatedCycle, accumulatedCycle);
    if (haps.length > 0) cps = Math.max(0, Number(haps[0].value)) || 0;
  }
  accumulatedCycle += deltaSec * cps;
  setRuntimeCps(cps);

  const cycle = (cpsPattern || cyclesPerSecond === 0) ? accumulatedCycle : nowSec * cyclesPerSecond;
  const t = Math.floor(cycle) + (cycle % 1);

  frameRenderer.render(screens, t, cps, cycle, rafAbsNow);

  // Record metrics
  const frameEnd = performance.now() - startTime;
  const frameDuration = frameEnd - now;
  const MAX_SAMPLES = 300;
  uzuMetrics.frameTimes.push(frameDuration);
  if (uzuMetrics.frameTimes.length > MAX_SAMPLES) uzuMetrics.frameTimes.shift();
  if (frameDuration > uzuMetrics.maxFrameTime) uzuMetrics.maxFrameTime = frameDuration;
  uzuMetrics.interFrameTimes.push(interFrameGap);
  if (uzuMetrics.interFrameTimes.length > MAX_SAMPLES) uzuMetrics.interFrameTimes.shift();
  if (interFrameGap > uzuMetrics.maxInterFrameTime) uzuMetrics.maxInterFrameTime = interFrameGap;
  const perfMem = (performance as any).memory;
  if (perfMem) uzuMetrics.heapSamples.push(perfMem.usedJSHeapSize);
  if (uzuMetrics.heapSamples.length > MAX_SAMPLES) uzuMetrics.heapSamples.shift();
  uzuMetrics.poolSize = frameRenderer.activeVideoEls.length;
  let freeCount = 0;
  for (const list of pool.freeVideoPool.values()) freeCount += list.length;
  uzuMetrics.freePoolSize = freeCount;
  uzuMetrics.screensCount = screens.length;
  uzuMetrics.eventsPerFrame = frameRenderer.lastEventCount;
  let naturalCount = 0, seekModeCount = 0;
  for (const el of frameRenderer.activeVideoEls) {
    if (el.paused) seekModeCount++;
    else if (isNativeRate(el.playbackRate)) naturalCount++;
    else seekModeCount++;
  }
  uzuMetrics.naturalCount = naturalCount;
  uzuMetrics.seekModeCount = seekModeCount;
  uzuMetrics.seeksHistory.push(uzuMetrics.seeksThisFrame);
  if (uzuMetrics.seeksHistory.length > 300) uzuMetrics.seeksHistory.shift();
  uzuMetrics.driftSeeksHistory.push(uzuMetrics.driftSeeksThisFrame);
  if (uzuMetrics.driftSeeksHistory.length > 300) uzuMetrics.driftSeeksHistory.shift();
  uzuMetrics.driftSeeksThisFrame = 0;

  flushWarnings();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- URL state ---
let currentCode = defaultCode;
export function getCurrentCode(): string { return currentCode; }

const urlState = loadFromUrl();
if (urlState) {
  initRegistry(urlState.media);
  currentCode = urlState.code;
}

setUrlWarnCallback((msg) => { if (msg) warn(msg); });
addOnChange(() => saveToUrl(currentCode, getAllEntries()));

// --- editor ---
setupEditor(
  document.getElementById("editor-wrap")!,
  currentCode,
  (code) => {
    currentCode = code;
    saveToUrl(code, getAllEntries());
  },
);
setupSidebar();
