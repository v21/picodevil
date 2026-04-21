import { silence } from "@strudel/core";
import "./visual-controls";
import { setupEditor } from "./editor";
import "./shuffle-stack";
import { VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND, PREWARM_LOOKAHEAD_MS, setRuntimeCps } from "./config";
import { resolveMedia, addMedia, clearAll as clearMediaRegistry, setDurationByUrl, loadVideo, loadImage, getAllEntries, initRegistry, addOnChange } from "./media-registry";
import { loadFromUrl, saveToUrl, setUrlWarnCallback } from "./url-state";
import { defaultCode } from "./editor";
import { renderVideoFrame } from "./video-playback";
import { type VideoEl } from "./video-element-state";
import { eventBeginFromHap } from "./event-begin";
import { drawFit } from "./draw-fit";
import { scoreFreeElement, computeExpectedFromEvent } from "./video-pool";
import { createVideoPoolManager } from "./video-pool-manager";
import { transpile, type WidgetCallInfo } from "./transpiler";
import { runTranspiled } from "./eval-sandbox";
import { slider as sliderWidget, resetWidgetCounter } from "./widgets";
import { warn, flushWarnings, clearWarnings } from "./warnings";
import { setupSidebar } from "./sidebar";
import { getStreamVideoEl, loadCamera, loadScreen } from "./stream-manager";


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

// --- video pool ---
const pool = createVideoPoolManager({
  resolveMediaUrl: (name, base) => {
    const entry = resolveMedia(name);
    return entry ? entry.url : base + name;
  },
  onDurationDiscovered: (srcUrl, duration) => {
    setDurationByUrl(srcUrl, duration);
  },
});

// --- images ---
const imagePool = new Map<string, HTMLImageElement>();

function getImageEl(name: string, base: string): HTMLImageElement {
  const srcUrl = pool.resolveMediaUrl(name, base);
  if (imagePool.has(srcUrl)) return imagePool.get(srcUrl)!;
  const el = new Image();
  el.src = srcUrl;
  el.addEventListener("load", () => console.log("image loaded:", name));
  el.addEventListener("error", () => console.error("image failed to load:", srcUrl));
  imagePool.set(srcUrl, el);
  return el;
}

function clearImages() {
  imagePool.clear();
}

/** Warm the blob cache for any video URLs in a screen (no video elements created). */
function prewarmBlobs(screen: Screen) {
  const probe = screen.queryArc(0, 1);
  for (const h of probe) {
    const v = h.value;
    if (v?._type === "video") {
      const base = v.urlBase ?? VIDEO_BASE;
      pool.fetchVideoBlob(pool.resolveMediaUrl(v.src, base));
    } else if (v?._type === "image") {
      const base = v.urlBase ?? IMAGE_BASE;
      getImageEl(v.src, base); // getImageEl handles resolution internally
    }
  }
}

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
  pool.clearVideos();
  clearImages();
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
    for (const s of screens) prewarmBlobs(s);
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

// --- performance metrics (exposed for stress testing) ---
const uzuMetrics = {
  frameTimes: [] as number[],   // last N frame durations in ms
  seekCount: 0,                 // total seeks this session
  poolSize: 0,                  // active video pool size
  freePoolSize: 0,              // free video pool size
  shareHits: 0,                 // times frameShareMap avoided a new element
  maxFrameTime: 0,              // worst frame time seen
  xLog: [] as number[],         // x values seen in render loop (for testing)
  reset() {
    this.frameTimes = [];
    this.seekCount = 0;
    this.shareHits = 0;
    this.maxFrameTime = 0;
    this.xLog = [];
  },
};
(window as any).uzuMetrics = uzuMetrics;

// --- render loop ---
let startTime = performance.now();
/** Per-frame video element assignments, keyed by draw position (screenIndex:eventIndex). */
const frameAssignments = new Map<string, VideoEl>();
// Expose for testing
(window as any)._uzuFrameAssignments = frameAssignments;

/** Threshold for sharing: two events showing the same src within this many seconds share an element. */
const SHARE_TIME_THRESHOLD = 0.04;


interface FrameEvent {
  screenIndex: number;
  eventIndex: number;
  ev: any;
  hap: any;
}

/** Phase 1: Query all screens and collect events. */
function collectFrameEvents(t: number): FrameEvent[] {
  const result: FrameEvent[] = [];
  for (let si = 0; si < screens.length; si++) {
    let events: any[];
    try {
      events = screens[si].queryArc(t, t);
    } catch (e) {
      warn(`queryArc failed on screen ${si}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!events || !Array.isArray(events)) {
      warn(`screen ${si}: queryArc returned non-array: ${typeof events}`);
      continue;
    }
    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei]?.value;
      if (ev == null || typeof ev !== "object") {
        warn(`screen ${si} event ${ei}: expected object value, got ${typeof ev}`);
        continue;
      }
      if (!ev._type) {
        warn(`screen ${si} event ${ei}: missing _type (got keys: ${Object.keys(ev).join(",")})`);
        continue;
      }
      result.push({ screenIndex: si, eventIndex: ei, ev, hap: events[ei] });
    }
  }
  return result;
}

/** Phase 2: Assign video elements for all video events.
 * Reuse by draw position (screenIndex:eventIndex) for frame-to-frame stability.
 * Share by content: same src + similar expectedTime → reuse the same element.
 */
function assignVideoElements(frameEvents: FrameEvent[], t: number, cps: number) {
  frameAssignments.clear();
  // Track expected times per assignment so sharing compares expected-to-expected
  // (not el.currentTime which may not have been seeked yet)
  const assignedExpected = new Map<string, { srcUrl: string; expected: number }>();

  // Pre-pass: build the set of srcs needed at each draw position this frame.
  // Free any active pool entries whose src won't match, so they're available
  // in freeVideoPool for reuse at other positions (e.g. after a shuffle rearranges).
  const neededSrc = new Map<string, string>();
  for (const fe of frameEvents) {
    if (fe.ev._type !== "video") continue;
    const drawPos = `${fe.screenIndex}:${fe.eventIndex}`;
    const base = fe.ev.urlBase ?? VIDEO_BASE;
    neededSrc.set(drawPos, pool.resolveMediaUrl(fe.ev.src, base));
  }
  for (const [key, el] of pool.videoPool) {
    const needed = neededSrc.get(key);
    if (needed === undefined || el._state.srcUrl !== needed) {
      pool.freeVideoEl(el);
      pool.videoPool.delete(key);
    }
  }

  for (const fe of frameEvents) {
    if (fe.ev._type !== "video") continue;

    const drawPos = `${fe.screenIndex}:${fe.eventIndex}`;
    const ev = fe.ev;
    const base = ev.urlBase ?? VIDEO_BASE;
    const srcUrl = pool.resolveMediaUrl(ev.src, base);
    const eventBegin = eventBeginFromHap(ev, fe.hap, t);
    const cachedDur = pool.videoDurations.get(srcUrl);
    const expectedTime = computeExpectedFromEvent(ev, t, eventBegin, cps, cachedDur);

    // 1. Reuse: same draw position, same src → keep same element
    const prev = pool.videoPool.get(drawPos);
    if (prev && prev._state.srcUrl === srcUrl) {
      frameAssignments.set(drawPos, prev);
      if (expectedTime != null) assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
      continue;
    }

    // 2. Share: another event already assigned this frame with same src at similar expected time
    let shared = false;
    if (expectedTime != null) {
      for (const [otherKey, el] of frameAssignments) {
        if (el._state.srcUrl !== srcUrl) continue;
        const other = assignedExpected.get(otherKey);
        if (!other || other.srcUrl !== srcUrl) continue;
        const dur = cachedDur ?? (isFinite(el.duration) ? el.duration : 0);
        const score = dur > 0 ? scoreFreeElement(other.expected, expectedTime, dur) : Math.abs(other.expected - expectedTime);
        if (score < SHARE_TIME_THRESHOLD) {
          frameAssignments.set(drawPos, el);
          assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
          uzuMetrics.shareHits++;
          shared = true;
          break;
        }
      }
    }
    if (shared) continue;

    // 3. Allocate from free pool, scored by proximity to expected time
    // Scrubbed events (begin===end) will be paused+seeked by renderVideoFrame,
    // so skip autoPlay to avoid a play→pause flash
    const isScrubbed = Number(ev.begin ?? 0) === Number(ev.end ?? 1);
    const el = pool.getVideoEl(ev.src, base, drawPos, expectedTime ?? undefined, !isScrubbed);
    frameAssignments.set(drawPos, el as VideoEl);
    if (expectedTime != null) assignedExpected.set(drawPos, { srcUrl, expected: expectedTime });
  }

  // Free active pool entries not used this frame
  for (const [key, el] of pool.videoPool) {
    if (!frameAssignments.has(key)) {
      pool.freeVideoEl(el);
      pool.videoPool.delete(key);
    }
  }
}

/** Phase 3: Draw all events. */
function drawFrameEvents(frameEvents: FrameEvent[], t: number, cps: number) {
  for (const fe of frameEvents) {
    const { screenIndex, eventIndex, ev, hap } = fe;

    // resolve position params
    const px = ev.x !== undefined ? Number(ev.x) : 0;
    if (ev.x !== undefined) uzuMetrics.xLog.push(px);
    const py = ev.y !== undefined ? Number(ev.y) : 0;
    const pw = ev.width !== undefined ? Number(ev.width) : 1;
    const ph = ev.height !== undefined ? Number(ev.height) : 1;
    if (isNaN(px) || isNaN(py) || isNaN(pw) || isNaN(ph)) {
      warn(`screen ${screenIndex} event ${eventIndex}: NaN in position (x=${ev.x}, y=${ev.y}, w=${ev.width}, h=${ev.height})`);
      continue;
    }

    const hasPosition = px !== 0 || py !== 0 || pw !== 1 || ph !== 1;

    // resolve rotation from event — applied before position so the whole cell rotates
    const TAU = Math.PI * 2;
    let rz = ev.rotateZ !== undefined ? Number(ev.rotateZ) : 0;
    let rxScale = 1; // X-axis rotation → Y scale
    let ryScale = 1; // Y-axis rotation → X scale
    if (ev.rotateX !== undefined) rxScale = Math.cos(Number(ev.rotateX) * TAU);
    if (ev.rotateY !== undefined) ryScale = Math.cos(Number(ev.rotateY) * TAU);
    if (ev.rotate !== undefined && ev.rotateAxis !== undefined) {
      const turns = Number(ev.rotate);
      const axisAngle = Number(ev.rotateAxis) * TAU;
      const cosAxis = Math.cos(axisAngle);
      const sinAxis = Math.sin(axisAngle);
      const cosTurns = Math.cos(turns * TAU);
      rxScale *= 1 - cosAxis * cosAxis * (1 - cosTurns);
      ryScale *= 1 - sinAxis * sinAxis * (1 - cosTurns);
    }
    const hasRotation = rz !== 0 || rxScale !== 1 || ryScale !== 1;
    if (hasRotation) {
      // Rotate around cell center so the whole screen (clip + content) spins
      const cx = (px + pw / 2) * canvas.width;
      const cy = (py + ph / 2) * canvas.height;
      ctx.save();
      ctx.translate(cx, cy);
      if (rxScale !== 1 || ryScale !== 1) ctx.scale(ryScale, rxScale);
      if (rz !== 0) ctx.rotate(rz * TAU);
      ctx.translate(-cx, -cy);
    }

    if (hasPosition) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(px * canvas.width, py * canvas.height, pw * canvas.width, ph * canvas.height);
      ctx.clip();
      ctx.translate(px * canvas.width, py * canvas.height);
      ctx.scale(pw, ph);
    }

    // resolve alpha from event
    if (ev.alpha !== undefined) {
      const a = Number(ev.alpha);
      if (isNaN(a)) {
        warn(`screen ${screenIndex} event ${eventIndex}: NaN alpha (raw=${ev.alpha})`);
      } else {
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
      }
    }

    // resolve blend mode from event
    const hasBlend = ev.blend !== undefined;
    if (hasBlend) {
      ctx.globalCompositeOperation = String(ev.blend) as GlobalCompositeOperation;
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

    try {
      if (ev._type === "color") {
        const currentColor = parseColor(ev.color);
        ctx.fillStyle = `rgb(${currentColor[0] * 255}, ${currentColor[1] * 255}, ${currentColor[2] * 255})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (ev._type === "image") {
        const base = ev.urlBase ?? IMAGE_BASE;
        const el = imagePool.get(pool.resolveMediaUrl(ev.src, base));
        if (el && el.naturalWidth > 0) {
          const fitMode = ev.objectfit ?? "cover";
          drawFit(ctx, el, el.naturalWidth, el.naturalHeight, canvas.width, canvas.height, fitMode,
            ev.cropx ?? 0.5, ev.cropy ?? 0.5, ev.cropw ?? 1, ev.croph ?? 1);
        }
      } else if (ev._type === "video") {
        const drawPos = `${screenIndex}:${eventIndex}`;
        const eventBegin = eventBeginFromHap(ev, hap, t);
        const el = frameAssignments.get(drawPos);
        if (el) {
          // Update playback (uses real el.duration for precision)
          if (isFinite(el.duration) && el.duration > 0) {
            renderVideoFrame({ ev, el, currentCycle: t, eventBegin, cps });
          }
          // Draw
          if (el.videoWidth > 0) {
            const fitMode = ev.objectfit ?? "cover";
            drawFit(ctx, el, el.videoWidth, el.videoHeight, canvas.width, canvas.height, fitMode,
              ev.cropx ?? 0.5, ev.cropy ?? 0.5, ev.cropw ?? 1, ev.croph ?? 1);
          }
        }
      } else if (ev._type === "stream") {
        const streamEl = getStreamVideoEl(ev.src);
        if (streamEl && streamEl.videoWidth > 0) {
          const fitMode = ev.objectfit ?? "cover";
          drawFit(ctx, streamEl, streamEl.videoWidth, streamEl.videoHeight, canvas.width, canvas.height, fitMode,
            ev.cropx ?? 0.5, ev.cropy ?? 0.5, ev.cropw ?? 1, ev.croph ?? 1);
        }
      } else {
        warn(`screen ${screenIndex} event ${eventIndex}: unknown _type "${ev._type}"`);
      }
    } catch (e) {
      warn(`screen ${screenIndex} event ${eventIndex} draw error: ${e instanceof Error ? e.message : e}`);
    }

    if (hasScale) ctx.restore();
    ctx.globalAlpha = 1;
    if (hasBlend) ctx.globalCompositeOperation = "source-over";
    if (hasPosition) ctx.restore();
    if (hasRotation) ctx.restore();
  }
}

/** Prewarm: query ahead, seek free pool elements toward future targets, create if needed. */
function prewarmVideos(cycle: number, cps: number) {
  const lookaheadCycles = (PREWARM_LOOKAHEAD_MS / 1000) * cps;
  const futureT = cycle + lookaheadCycles;

  for (const screen of screens) {
    let futureEvents: any[];
    try {
      futureEvents = screen.queryArc(futureT, futureT);
      if (!futureEvents || !Array.isArray(futureEvents)) continue;
    } catch { continue; }

    for (const hap of futureEvents) {
      const ev = hap?.value;
      if (!ev || ev._type !== "video") continue;

      const base = ev.urlBase ?? VIDEO_BASE;
      const srcUrl = pool.resolveMediaUrl(ev.src, base);
      const eventBegin = eventBeginFromHap(ev, hap, futureT);
      const cachedDur = pool.videoDurations.get(srcUrl);
      const expectedTime = computeExpectedFromEvent(ev, futureT, eventBegin, cps, cachedDur);

      // Start blob fetch if needed
      pool.fetchVideoBlob(srcUrl);

      // Check if any free element exists for this src
      const freeList = pool.freeVideoPool.get(srcUrl);
      if (freeList && freeList.length > 0 && expectedTime != null) {
        // Seek the best free element toward the future target
        let bestIdx = 0;
        let bestScore = Infinity;
        for (let i = 0; i < freeList.length; i++) {
          const dur = isFinite(freeList[i].duration) ? freeList[i].duration : (cachedDur ?? 0);
          const score = scoreFreeElement(freeList[i].currentTime, expectedTime, dur);
          if (score < bestScore) { bestScore = score; bestIdx = i; }
        }
        const best = freeList[bestIdx];
        // Seek if it's far from target and not already seeking
        if (!best._state.seeking && bestScore > 0.15) {
          best.currentTime = expectedTime;
        }
        continue;
      }

      // Also check if already active
      const alreadyActive = [...pool.videoPool.values()].some(el => el._state.srcUrl === srcUrl);
      if (alreadyActive) continue;

      // No element at all — create one and park in free pool
      const el = pool.makeVideoEl(ev.src);
      el._state.srcUrl = srcUrl;
      const blobUrl = pool.videoBlobUrls.get(srcUrl);
      el.src = blobUrl ?? srcUrl;
      el.preload = "auto";

      // Pre-seek once metadata loads
      el.addEventListener("loadedmetadata", () => {
        const realExpected = computeExpectedFromEvent(ev, futureT, eventBegin, cps, el.duration);
        if (realExpected != null) el.currentTime = realExpected;
      }, { once: true });

      pool.freeVideoEl(el);
    }
  }
}

function frame() {
  const now = performance.now() - startTime;
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
  const cyclePos = cycle % 1;
  const cycleNum = Math.floor(cycle);

  const t = cycleNum + cyclePos;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Phase 1: Collect all events
  const frameEvents = collectFrameEvents(t);

  // Phase 2: Assign video elements
  assignVideoElements(frameEvents, t, cps);

  // Phase 3: Draw
  drawFrameEvents(frameEvents, t, cps);

  // Phase 4: Prewarm
  if (cps > 0) prewarmVideos(cycle, cps);

  // Record metrics
  const frameEnd = performance.now() - startTime;
  const frameDuration = frameEnd - now;
  uzuMetrics.frameTimes.push(frameDuration);
  if (uzuMetrics.frameTimes.length > 300) uzuMetrics.frameTimes.shift(); // keep last 5s at 60fps
  if (frameDuration > uzuMetrics.maxFrameTime) uzuMetrics.maxFrameTime = frameDuration;
  uzuMetrics.poolSize = pool.videoPool.size;
  let freeCount = 0;
  for (const list of pool.freeVideoPool.values()) freeCount += list.length;
  uzuMetrics.freePoolSize = freeCount;

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
