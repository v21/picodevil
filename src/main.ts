import { mini } from "@strudel/mini";
import {
  sine, sine2, cosine, cosine2,
  saw, saw2, isaw, isaw2,
  tri, tri2, itri, itri2,
  square, square2,
  rand, rand2, irand, brand, brandBy,
  perlin,
  time, mouseX, mouseY,
  run, choose, chooseIn, chooseCycles,
  signal, steady,
} from "@strudel/core";
import "./pattern-extensions";
import "./visual-controls";
import { setupEditor } from "./editor";
import { color as makeColor } from "./color-pattern";
import { video as makeVideo } from "./video-pattern";
import { image as makeImage } from "./image-pattern";
import { GridPattern } from "./grid-pattern";
import { ScreenPattern } from "./screen-pattern";
import { VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND } from "./config";
import { renderVideoFrame } from "./video-playback";
import { drawFit } from "./draw-fit";
import { transpile } from "./transpiler";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", resize);
resize();

// --- state ---
/** A screen is anything with queryArc — ScreenPattern subclasses or plain Patterns. */
type Screen = { queryArc(begin: number, end: number): any[] };
let screens: Screen[] = [];
let cyclesPerSecond = CYCLES_PER_SECOND;

// --- $: label system ---
let pPatterns: Record<string, Screen> = {};
let anonymousIndex = 0;

/** Inject .p() onto both ScreenPattern.prototype and Pattern.prototype. */
function injectP(proto: any) {
  proto.p = function (id: string) {
    if (id.startsWith('_') || id.endsWith('_')) return this;
    if (id.includes('$')) {
      id = `${id}${anonymousIndex}`;
      anonymousIndex++;
    }
    pPatterns[id] = this;
    return this;
  };
}
injectP(ScreenPattern.prototype);
import { reify } from "@strudel/core";
injectP(Object.getPrototypeOf(reify(0)));  // Pattern.prototype

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

// --- video ---
type VideoEl = HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean; _srcUrl?: string };
const videoPool = new Map<string, VideoEl>();       // active elements by pool key
const freeVideoPool = new Map<string, VideoEl[]>(); // idle elements by original src URL, ready for reuse
const videoBlobUrls = new Map<string, string>();    // network URL -> blob URL (one fetch per file)
const videoBlobPending = new Map<string, Promise<void>>(); // in-flight fetches

/** Fetch a video URL as a blob and cache the object URL. One network load per unique URL. */
function fetchVideoBlob(srcUrl: string): void {
  if (videoBlobUrls.has(srcUrl) || videoBlobPending.has(srcUrl)) return;
  const p = fetch(srcUrl)
    .then(r => r.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      videoBlobUrls.set(srcUrl, blobUrl);
      videoBlobPending.delete(srcUrl);
      console.log("video cached as blob:", srcUrl);
    })
    .catch(e => {
      videoBlobPending.delete(srcUrl);
      console.error("video blob fetch failed:", srcUrl, e);
    });
  videoBlobPending.set(srcUrl, p);
}

function makeVideoEl(name: string): VideoEl {
  const el = document.createElement("video") as VideoEl;
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.addEventListener("loadeddata", () => console.log("video loaded:", name));
  el.addEventListener("seeking", () => { el._seeking = true; });
  el.addEventListener("seeked", () => { el._seeking = false; });
  return el;
}

function getVideoEl(name: string, base: string = VIDEO_BASE, keyPrefix: string = ""): HTMLVideoElement {
  const key = keyPrefix + base + name;
  if (videoPool.has(key)) return videoPool.get(key)!;

  const srcUrl = base + name;

  // Reuse an idle element with the same src (already loaded/buffered)
  const freeList = freeVideoPool.get(srcUrl);
  if (freeList && freeList.length > 0) {
    const el = freeList.pop()!;
    if (freeList.length === 0) freeVideoPool.delete(srcUrl);
    el._reverseAcc = 0;
    el._seeking = false;
    el._srcUrl = srcUrl;
    el.playbackRate = 1;
    el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
    videoPool.set(key, el);
    return el;
  }

  // Create new element; use blob URL if cached, otherwise stream directly + background blob fetch
  const el = makeVideoEl(name);
  el._srcUrl = srcUrl;
  const blobUrl = videoBlobUrls.get(srcUrl);
  el.src = blobUrl ?? srcUrl;
  if (!blobUrl) fetchVideoBlob(srcUrl); // cache for future elements
  el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
  videoPool.set(key, el);
  return el;
}

function video(pat: string) {
  return makeVideo(pat);
}

function clearVideos() {
  // Move active elements to free pool for reuse instead of destroying
  for (const el of videoPool.values()) {
    el.pause();
    const srcUrl = el._srcUrl ?? el.src;
    const freeList = freeVideoPool.get(srcUrl) ?? [];
    freeList.push(el);
    freeVideoPool.set(srcUrl, freeList);
  }
  videoPool.clear();
}

// --- images ---
const imagePool = new Map<string, HTMLImageElement>();

function getImageEl(name: string, base: string): HTMLImageElement {
  const key = base + name;
  if (imagePool.has(key)) return imagePool.get(key)!;
  const el = new Image();
  el.src = base + name;
  el.addEventListener("load", () => console.log("image loaded:", name));
  el.addEventListener("error", () => console.error("image failed to load:", key));
  imagePool.set(key, el);
  return el;
}

function image(pat: string) {
  return makeImage(pat);
}

function clearImages() {
  imagePool.clear();
}

function color(pat: string) {
  return makeColor(pat);
}

function grid(children: Screen[], cols: number | string, rows: number | string): GridPattern {
  return new GridPattern(children as any, cols, rows, mini, applyGrid);
}

function four(children: Screen[]): GridPattern {
  return grid(children, 2, 2);
}

/** Warm the blob cache for any video URLs in a screen (no video elements created). */
function prewarmBlobs(screen: Screen) {
  if (screen instanceof GridPattern) {
    prewarmGrid(screen);
  } else if ('queryArc' in screen && !(screen instanceof ScreenPattern)) {
    // Plain pattern — probe for video/image events to prewarm
    const probe = screen.queryArc(0, 1);
    for (const h of probe) {
      const v = h.value;
      if (v?._type === "video") {
        const base = v.urlBase ?? VIDEO_BASE;
        fetchVideoBlob(base + v.src);
      } else if (v?._type === "image") {
        const base = v.urlBase ?? IMAGE_BASE;
        getImageEl(v.src, base);
      }
    }
  }
}

function prewarmGrid(gp: GridPattern) {
  for (const child of gp.children) prewarmBlobs(child);
  for (const override of gp.overrides) {
    if (override.type === 'set') prewarmBlobs(override.screen);
  }
}

function applyGrid(gp: GridPattern) {
  prewarmGrid(gp);
  screens.push(gp);
  console.log("grid screen added, screen count:", screens.length);
}

function setCps(cps: number) {
  cyclesPerSecond = cps;
}


// called from editor on ctrl+enter
window.uzuEval = (code: string): string | null => {
  clearVideos();
  clearImages();
  screens = [];
  lastScreenVals = [];
  pPatterns = {};
  anonymousIndex = 0;
  try {
    const transpiled = transpile(code);
    const signals = {
      sine, sine2, cosine, cosine2,
      saw, saw2, isaw, isaw2,
      tri, tri2, itri, itri2,
      square, square2,
      rand, rand2, irand, brand, brandBy,
      perlin,
      time, mouseX, mouseY,
      run, choose, chooseIn, chooseCycles,
      signal, steady,
    };
    const sigNames = Object.keys(signals);
    new Function("mini", "color", "video", "image", "grid", "four", "setCps", ...sigNames, transpiled)(
      mini, color, video, image, grid, four, setCps, ...Object.values(signals),
    );
    // Collect $: registered patterns; merge with .out() pushed screens
    const pScreens = collectScreens();
    if (pScreens.length > 0) {
      screens = [...screens, ...pScreens];
    }
    // Prewarm all screens
    for (const s of screens) prewarmBlobs(s);
    console.log("evaluated:", code, "screens:", screens.length);
    return null;
  } catch (e) {
    console.error("eval error:", e);
    return e instanceof Error ? e.message : String(e);
  }
};

// --- color lookup ---
const colorCache = new Map<string, [number, number, number]>();
const scratchCtx = document.createElement("canvas").getContext("2d")!;

function parseColor(val: string): [number, number, number] {
  const cached = colorCache.get(val);
  if (cached) return cached;
  scratchCtx.fillStyle = "#000";
  scratchCtx.fillStyle = val;
  const hex = scratchCtx.fillStyle;
  // fillStyle normalizes to #rrggbb or rgb(...) — if it stayed #000000 and input wasn't black, it's invalid
  if (hex === "#000000" && val !== "black" && val !== "#000000" && val !== "#000") {
    colorCache.set(val, [1, 1, 1]);
    return [1, 1, 1];
  }
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) {
    const result: [number, number, number] = [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
    colorCache.set(val, result);
    return result;
  }
  colorCache.set(val, [1, 1, 1]);
  return [1, 1, 1];
}

// --- render loop ---
const startTime = performance.now();
let lastFrameTime = startTime;
let lastScreenVals: (string | null)[] = [];

function renderScreen(screen: Screen, cyclePos: number, cycleNum: number, now: number, dt: number, screenIndex: number, videoKeyPrefix: string = "") {
  const t = cycleNum + cyclePos;
  const events = screen.queryArc(t, t + 0.001);
  if (!events.length) return;
  const ev = events[0].value;

  // resolve alpha from event
  if (ev.alpha !== undefined) {
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(ev.alpha)));
  }

  // resolve scale from event
  const sx = ev.scaleX !== undefined ? Number(ev.scaleX) : 1;
  const sy = ev.scaleY !== undefined ? Number(ev.scaleY) : 1;
  const hasScale = sx !== 1 || sy !== 1;
  if (hasScale) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(sx, sy);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  if (ev._type === "color") {
    const currentColor = parseColor(ev.color);
    ctx.fillStyle = `rgb(${currentColor[0] * 255}, ${currentColor[1] * 255}, ${currentColor[2] * 255})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (ev._type === "image") {
    const base = ev.urlBase ?? IMAGE_BASE;
    const el = imagePool.get(base + ev.src);
    if (el && el.naturalWidth > 0) {
      const fitMode = ev.fit ?? "cover";
      drawFit(ctx, el, el.naturalWidth, el.naturalHeight, canvas.width, canvas.height, fitMode);
    }
  } else if (ev._type === "video") {
    const videoResult = renderVideoFrame({
      ev,
      videoPool, poolKeyPrefix: videoKeyPrefix, canvas, ctx,
      now, dt,
      lastVideoVal: lastScreenVals[screenIndex] ?? null,
      getOrCreateVideoEl: getVideoEl,
    });
    lastScreenVals[screenIndex] = videoResult.lastVideoVal;
  } else if (screen instanceof GridPattern) {
    renderGridScreen(screen, cyclePos, cycleNum, now, dt, videoKeyPrefix);
  }

  if (hasScale) ctx.restore();
  ctx.globalAlpha = 1;
}

function renderGridScreen(gridScreen: GridPattern, cyclePos: number, cycleNum: number, now: number, dt: number, parentKeyPrefix: string = "") {
  const t = cycleNum + cyclePos;
  const { cols, rows } = gridScreen.resolveGrid(t);
  const totalCells = cols * rows;
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;

  // Grow cellState on demand for current grid size
  while (gridScreen.cellState.length < totalCells) {
    gridScreen.cellState.push(null);
  }

  // Temporarily redirect video state tracking to grid's cellState
  const savedVals = lastScreenVals;
  lastScreenVals = gridScreen.cellState;

  for (let i = 0; i < totalCells; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    ctx.save();
    ctx.beginPath();
    ctx.rect(col * cellW, row * cellH, cellW, cellH);
    ctx.clip();
    ctx.translate(col * cellW, row * cellH);
    ctx.scale(cellW / canvas.width, cellH / canvas.height);

    // Resolve child and determine key prefix — overrides share a single element
    const { child, overrideIndex } = gridScreen.resolveChildWithOverride(i, t);
    const keyPrefix = overrideIndex >= 0
      ? `${parentKeyPrefix}override${overrideIndex}:`
      : `${parentKeyPrefix}cell${i}:`;
    renderScreen(child, cyclePos, cycleNum, now, dt, i, keyPrefix);

    ctx.restore();
  }

  lastScreenVals = savedVals;
}

function frame() {
  const now = performance.now() - startTime;
  const nowSec = now / 1000;
  const cyclePos = (nowSec * cyclesPerSecond) % 1;
  const cycleNum = Math.floor(nowSec * cyclesPerSecond);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // draw screens in order
  for (let i = 0; i < screens.length; i++) {
    renderScreen(screens[i], cyclePos, cycleNum, now, now - lastFrameTime, i);
  }

  lastFrameTime = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- editor ---
setupEditor(document.getElementById("editor-wrap")!);
