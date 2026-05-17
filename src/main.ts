import "./visual-controls";
import { setupEditor } from "./editor";
import "./shuffle-stack";
import { CYCLES_PER_SECOND, setRuntimeCps, MAX_FREE_VIDEO_ELEMENTS, MAX_BLOB_CACHE_BYTES } from "./config";
import { CpsController } from "./cps-controller";
import { createMetrics, recordFrameMetrics } from "./frame-metrics";
import { resolveMedia, addMedia, clearAll as clearMediaRegistry, setDurationByUrl, loadVideo, loadImage, getAllEntries, initRegistry, addOnChange } from "./media-registry";
import { initRegistry as initPatternRegistry, each, all } from "./pattern-registry";
import { loadFromUrl, saveToUrl, setUrlWarnCallback } from "./url-state";
import { defaultCode } from "./editor";
import { createVideoPoolManager } from "./video-pool-manager";
import { slider as sliderWidget, fontPicker as fontPickerWidget } from "./widgets";
import { initFontList } from "./font-list";
import { repopulateFontDatalist } from "./editor-widgets";
import { warn, flushWarnings } from "./warnings";
import { setupSidebar } from "./sidebar";
import { loadCamera, loadScreen } from "./stream-manager";
import { fft, updateFrame as fftUpdateFrame, applyFftConfig, getFftConfig, onFftConfigChange } from "./fft-audio";
import { WebGLRenderer } from "./webgl-renderer";
import { FrameRenderer } from "./renderer";
import type { Renderer } from "./renderer-interface";
import { EvalController } from "./eval-controller";

import { Pattern, useRNG } from "@strudel/core";
useRNG('precise');
initPatternRegistry();

const canvas = document.getElementById("c") as HTMLCanvasElement;

const activeRenderer: Renderer = new WebGLRenderer(canvas);

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  activeRenderer.resize(canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

// --- performance metrics (exposed for stress testing) ---
const uzuMetrics = createMetrics();
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
const cpsController = new CpsController(CYCLES_PER_SECOND, performance.now());

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
  cpsController.setCps(cps, performance.now());
}

function setCpm(cpm: number | Pattern) {
  cpsController.setCpm(cpm, performance.now());
}

// Expose media registry for monkey tester
(window as any).uzuAddMedia = addMedia;
(window as any).uzuClearMedia = clearMediaRegistry;

const evalController = new EvalController({
  clearActiveVideos: () => pool.clearVideos(frameRenderer.activeVideoEls.splice(0)),
  prewarmScreen: (s) => frameRenderer.prewarmBlobs(s),
  snapshotCps: () => cpsController.snapshot(),
  restoreCps: (snap) => cpsController.restore(snap),
  globals: {
    setCps, setCpm,
    loadVideo, loadImage, loadCamera, loadScreen,
    slider: sliderWidget,
    fontPicker: fontPickerWidget,
    each, all,
    fft,
  },
});

initFontList(repopulateFontDatalist);

// called from editor on ctrl+enter
window.uzuEval = (code) => evalController.eval(code);

// --- render loop ---
let lastRafAbsTime = performance.now();

// Expose active video elements for testing/debugging
(window as any)._uzuActiveVideoEls = frameRenderer.activeVideoEls;

function frame() {
  const rafAbsNow = performance.now();
  const interFrameGap = rafAbsNow - lastRafAbsTime;
  lastRafAbsTime = rafAbsNow;

  const { cps, cycle, t } = cpsController.tick(rafAbsNow);
  setRuntimeCps(cps);
  fftUpdateFrame();

  frameRenderer.render(evalController.screens, evalController.namedScreens, t, cps, cycle, rafAbsNow);

  const frameDuration = performance.now() - rafAbsNow;
  const perfMem = (performance as any).memory;
  recordFrameMetrics(
    uzuMetrics, frameDuration, interFrameGap,
    frameRenderer.activeVideoEls, pool.freeVideoPool,
    evalController.screens.length, frameRenderer.lastEventCount,
    perfMem ? perfMem.usedJSHeapSize : undefined,
  );

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
  if (urlState.fft) applyFftConfig(urlState.fft);
}

setUrlWarnCallback((msg) => { if (msg) warn(msg); });
const saveUrl = () => saveToUrl(currentCode, getAllEntries(), getFftConfig());
addOnChange(saveUrl);
onFftConfigChange(saveUrl);

// --- editor ---
setupEditor(
  document.getElementById("editor-wrap")!,
  currentCode,
  (code) => {
    currentCode = code;
    saveUrl();
  },
);
setupSidebar();
