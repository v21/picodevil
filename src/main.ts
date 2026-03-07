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
import { setupEditor } from "./editor";
import { ColorPattern } from "./color-pattern";
import { VideoPattern } from "./video-pattern";
import { ImagePattern } from "./image-pattern";
import { GridPattern } from "./grid-pattern";
import type { ScreenPattern } from "./screen-pattern";
import { VIDEO_BASE, IMAGE_BASE, CYCLES_PER_SECOND } from "./config";
import { renderVideoFrame } from "./video-playback";
import { drawFit } from "./draw-fit";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", resize);
resize();

// --- state ---
let screens: ScreenPattern[] = [];
let cyclesPerSecond = CYCLES_PER_SECOND;

// --- video ---
const videoPool = new Map<string, HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean }>();

function getVideoEl(name: string, base: string = VIDEO_BASE, keyPrefix: string = ""): HTMLVideoElement {
  const key = keyPrefix + base + name;
  if (videoPool.has(key)) return videoPool.get(key)!;
  const el = document.createElement("video") as HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean };
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.src = base + name;
  el.addEventListener("loadeddata", () => console.log("video loaded:", name));
  el.addEventListener("seeking", () => { el._seeking = true; });
  el.addEventListener("seeked", () => { el._seeking = false; });
  el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
  videoPool.set(key, el);
  return el;
}

function video(pat: string): VideoPattern {
  return VideoPattern.fromSrc(mini(pat), mini, applyVideo);
}

function applyVideo(vp: VideoPattern) {
  const base = vp.videoUrlBase ?? VIDEO_BASE;
  const probe = vp.srcPattern.queryArc(0, 1);
  for (const ev of probe) getVideoEl(ev.value, base);
  screens.push(vp);
  console.log("video screen added, screen count:", screens.length);
}

function clearVideos() {
  for (const el of videoPool.values()) {
    el.pause();
    el.removeAttribute("src");
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

function image(pat: string): ImagePattern {
  return ImagePattern.fromSrc(mini(pat), mini, applyImage);
}

function applyImage(ip: ImagePattern) {
  const base = ip.imageUrlBase ?? IMAGE_BASE;
  const probe = ip.srcPattern.queryArc(0, 1);
  for (const ev of probe) getImageEl(ev.value, base);
  screens.push(ip);
  console.log("image screen added, screen count:", screens.length);
}

function clearImages() {
  imagePool.clear();
}

function color(pat: string): ColorPattern {
  return ColorPattern.fromMini(mini(pat), mini, applyColor);
}

function grid(children: ScreenPattern[], cols: number, rows: number): GridPattern {
  return new GridPattern(children, cols, rows, mini, applyGrid);
}

function four(children: ScreenPattern[]): GridPattern {
  return grid(children, 2, 2);
}

function applyGrid(gp: GridPattern, keyPrefix: string = "") {
  // Recursively pre-warm all media in children, with per-cell video elements
  for (let i = 0; i < gp.children.length; i++) {
    const child = gp.children[i];
    const cellPrefix = `${keyPrefix}cell${i}:`;
    if (child instanceof VideoPattern) {
      const base = child.videoUrlBase ?? VIDEO_BASE;
      const probe = child.srcPattern.queryArc(0, 1);
      for (const ev of probe) getVideoEl(ev.value, base, cellPrefix);
    } else if (child instanceof ImagePattern) {
      const base = child.imageUrlBase ?? IMAGE_BASE;
      const probe = child.srcPattern.queryArc(0, 1);
      for (const ev of probe) getImageEl(ev.value, base);
    } else if (child instanceof GridPattern) {
      applyGrid(child, cellPrefix);
    }
  }
  screens.push(gp);
  console.log("grid screen added, screen count:", screens.length);
}

function setCps(cps: number) {
  cyclesPerSecond = cps;
}

function applyColor(cp: ColorPattern) {
  screens.push(cp);
  console.log("color screen added, screen count:", screens.length);
}

// called from editor on ctrl+enter
window.uzuEval = (code: string): string | null => {
  clearVideos();
  clearImages();
  screens = [];
  lastScreenVals = [];
  try {
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
    new Function("mini", "color", "video", "image", "grid", "four", "setCps", ...sigNames, code)(
      mini, color, video, image, grid, four, setCps, ...Object.values(signals),
    );
    console.log("evaluated:", code);
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

function renderScreen(screen: ScreenPattern, cyclePos: number, cycleNum: number, now: number, dt: number, screenIndex: number, videoKeyPrefix: string = "") {
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

  if (screen instanceof ColorPattern) {
    const currentColor = parseColor(ev.color);
    ctx.fillStyle = `rgb(${currentColor[0] * 255}, ${currentColor[1] * 255}, ${currentColor[2] * 255})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (screen instanceof ImagePattern) {
    const base = screen.imageUrlBase ?? IMAGE_BASE;
    const el = imagePool.get(base + ev.src);
    if (el && el.naturalWidth > 0) {
      drawFit(ctx, el, el.naturalWidth, el.naturalHeight, canvas.width, canvas.height, screen.fitMode);
    }
  } else if (screen instanceof VideoPattern) {
    const videoResult = renderVideoFrame({
      ev,
      videoPattern: screen,
      videoPool, poolKeyPrefix: videoKeyPrefix, canvas, ctx,
      now, dt,
      lastVideoVal: lastScreenVals[screenIndex] ?? null,
    });
    lastScreenVals[screenIndex] = videoResult.lastVideoVal;
  } else if (screen instanceof GridPattern) {
    renderGridScreen(screen, cyclePos, cycleNum, now, dt, videoKeyPrefix);
  }

  if (hasScale) ctx.restore();
  ctx.globalAlpha = 1;
}

function renderGridScreen(gridScreen: GridPattern, cyclePos: number, cycleNum: number, now: number, dt: number, parentKeyPrefix: string = "") {
  const cellW = canvas.width / gridScreen.cols;
  const cellH = canvas.height / gridScreen.rows;

  // Temporarily redirect video state tracking to grid's cellState
  const savedVals = lastScreenVals;
  lastScreenVals = gridScreen.cellState;

  for (let i = 0; i < gridScreen.children.length; i++) {
    const col = i % gridScreen.cols;
    const row = Math.floor(i / gridScreen.cols);

    ctx.save();
    ctx.beginPath();
    ctx.rect(col * cellW, row * cellH, cellW, cellH);
    ctx.clip();
    ctx.translate(col * cellW, row * cellH);
    ctx.scale(cellW / canvas.width, cellH / canvas.height);

    renderScreen(gridScreen.children[i], cyclePos, cycleNum, now, dt, i, `${parentKeyPrefix}cell${i}:`);

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
