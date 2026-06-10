import "./visual-controls";
import { setupEditor } from "./editor";
import "./shuffle-stack";
import { CYCLES_PER_SECOND, setRuntimeCps, MAX_FREE_VIDEO_ELEMENTS } from "./config";
import { CpsController } from "./cps-controller";
import { createMetrics, recordFrameMetrics } from "./frame-metrics";
import { resolveMedia, addMedia, clearAll as clearMediaRegistry, setDurationByUrl, loadVideo, loadImage, getAllEntries, initRegistry, addOnChange } from "./media-registry";
import { resolveUrl, probeHealth, getServerUrl } from "./server-config";
import { initRegistry as initPatternRegistry, each, all } from "./pattern-registry";
import { loadFromUrl, saveToUrl, setUrlWarnCallback, hashLooksCorrupt } from "./url-state";
import { defaultCode } from "./editor";
import { pickAutostartCode } from "./examples";
import { createVideoPoolManager } from "./video-pool-manager";
import { slider as sliderWidget, fontPicker as fontPickerWidget } from "./widgets";
import { initFontList } from "./font-list";
import { repopulateFontDatalist } from "./editor-widgets";
import { warn, flushWarnings } from "./warnings";
import { setupSidebar } from "./sidebar";
import { loadCamera, loadScreen } from "./stream-manager";
import { fft, updateFrame as fftUpdateFrame, applyFftConfig, getFftConfig, onFftConfigChange } from "./fft-audio";
import { WebGLRenderer } from "./webgl-renderer";
import { showFatalOverlay } from "./fatal-overlay";
import { FrameRenderer } from "./renderer";
import type { Renderer } from "./renderer-interface";
import { EvalController } from "./eval-controller";

import { Pattern, useRNG } from "@strudel/core";
useRNG('precise');
initPatternRegistry();

const canvas = document.getElementById("c") as HTMLCanvasElement;

// The entire app is a WebGL2 canvas. If the context can't be created (no WebGL2,
// hardware acceleration disabled, blocklisted GPU), the WebGLRenderer constructor
// throws — catch it and show an explainer instead of a silent black page + dead
// editor (the throw would otherwise abort the whole module).
let activeRenderer: Renderer;
try {
  activeRenderer = new WebGLRenderer(canvas);
} catch (err) {
  showFatalOverlay(
    "This browser can't run picodevil",
    "picodevil needs WebGL2 with hardware acceleration. Try a recent Chrome, Edge, or Firefox, and make sure hardware acceleration is enabled in your browser settings.",
  );
  throw err;
}

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  activeRenderer.resize(canvas.width, canvas.height);
}
window.addEventListener("resize", resize);
resize();

// --- performance metrics (exposed for stress testing) ---
const pdMetrics = createMetrics();
(window as any).pdMetrics = pdMetrics;
(window as any).pdPerfInfo = () => {
  return {
    naturalCount: pdMetrics.naturalCount,
    seekCount: pdMetrics.seekModeCount,
    screensCount: pdMetrics.screensCount,
    eventsPerFrame: pdMetrics.eventsPerFrame,
    seeksThisFrame: pdMetrics.seeksThisFrame,
    seeksPer300f: pdMetrics.seeksHistory.reduce((a, b) => a + b, 0),
    driftSeeksPer300f: pdMetrics.driftSeeksHistory.reduce((a, b) => a + b, 0),
  };
};

// --- video pool ---
const pool = createVideoPoolManager({
  resolveMediaUrl: (name, base) => {
    const entry = resolveMedia(name);
    return entry ? resolveUrl(entry.url) : base + name;
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
  // Free the GPU texture when the pool permanently evicts an element, so video
  // textures + detached elements don't accumulate over a long set.
  onDestroyElement: (el) => activeRenderer.releaseSource?.(el),
});

const frameRenderer = new FrameRenderer(activeRenderer, pool, pdMetrics);
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
(window as any).pdAddMedia = addMedia;
(window as any).pdClearMedia = clearMediaRegistry;

const evalController = new EvalController({
  clearActiveVideos: () => pool.clearVideos(frameRenderer.activeVideoEls.splice(0)),
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

// Probe the optional companion server in the background so server-gated flows
// (upload/download) know whether it's reachable. No-op if no URL is configured.
if (getServerUrl()) {
  probeHealth().catch(() => {/* status set internally */});
}

// called from editor on ctrl+enter
window.pdEval = (code) => evalController.eval(code);

// Reset tempo to the default cps. Called when loading an example so a previous
// example's setCps()/setCpm() doesn't carry over into one that doesn't set it.
(window as any).pdResetCps = () => cpsController.reset(performance.now());

// --- render loop ---
let lastRafAbsTime = performance.now();
let rafPaused = false;

// Expose active video elements for testing/debugging
(window as any)._pdActiveVideoEls = frameRenderer.activeVideoEls;

function frame() {
  if (rafPaused) { requestAnimationFrame(frame); return; }
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
    pdMetrics, frameDuration, interFrameGap,
    frameRenderer.activeVideoEls, pool.freeVideoPool,
    evalController.screens.length, frameRenderer.lastEventCount,
    perfMem ? perfMem.usedJSHeapSize : undefined,
  );

  flushWarnings();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test-only deterministic-render hooks. Used by golden-render harness and
// future visual regression tests. pdRenderAt synchronously renders one frame
// at a caller-supplied cycle position; pdPauseRaf stops the running rAF loop
// so subsequent captures aren't overwritten before being read.
(window as any).pdPauseRaf = () => { rafPaused = true; };
(window as any).pdResumeRaf = () => { rafPaused = false; };
// `wallMs`, when supplied, pins the wall-clock time handed to the renderer
// instead of `performance.now()`. Wall-clock-driven playback (sync()/rolling())
// otherwise advances between two renders at the same cycle, so a settle loop
// never stabilizes; pinning it lets warm video renders be reproducible.
(window as any).pdRenderAt = (cycle: number, cps = 0.5, wallMs?: number) => {
  const t = Math.floor(cycle) + (cycle % 1);
  setRuntimeCps(cps);
  const wall = wallMs ?? performance.now();
  frameRenderer.render(evalController.screens, evalController.namedScreens, t, cps, cycle, wall);
};

// --- URL state ---
let currentCode = defaultCode;
export function getCurrentCode(): string { return currentCode; }

const urlState = loadFromUrl();
if (!urlState && hashLooksCorrupt(window.location.hash)) {
  // The link carried a v1 state envelope that didn't decode (truncated by a chat
  // app/proxy, hand-edited, etc.). Tell the user their work was dropped instead of
  // silently opening a fresh session.
  warn("This shared link looks corrupted or truncated — couldn't restore it, starting a fresh session instead.");
}
if (urlState) {
  initRegistry(urlState.media);
  currentCode = urlState.code;
  if (urlState.fft) applyFftConfig(urlState.fft);
} else {
  // Fresh session: greet the visitor with a random autostart-eligible example,
  // paired with the CDN defaults the media loader auto-pulls. Flashing examples
  // are excluded via `autostart: false`. Source names resolve at query time, so
  // it renders once the async defaults land — no re-eval needed.
  currentCode = pickAutostartCode() || defaultCode;
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
// A fresh session = no saved URL state. Tells the media loader to auto-pull the
// curated CDN defaults so a first-time visitor lands with media ready.
setupSidebar(!urlState);
