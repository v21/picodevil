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
import type { ScreenPattern } from "./screen-pattern";
import { VIDEO_BASE, CYCLES_PER_SECOND } from "./config";
import { renderVideoFrame } from "./video-playback";

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

function getVideoEl(name: string, base: string = VIDEO_BASE): HTMLVideoElement {
  const key = base + name;
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
  const srcPattern = mini(pat);
  return new VideoPattern(srcPattern, {}, mini, applyVideo);
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

function color(pat: string): ColorPattern {
  return new ColorPattern(mini(pat), mini, applyColor);
}

function setCps(cps: number) {
  cyclesPerSecond = cps;
}

function applyColor(cp: ColorPattern) {
  screens.push(cp);
  console.log("color screen added, screen count:", screens.length);
}

// called from editor on ctrl+enter
window.uzuEval = (code: string) => {
  clearVideos();
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
    new Function("mini", "color", "video", "setCps", ...sigNames, code)(
      mini, color, video, setCps, ...Object.values(signals),
    );
    console.log("evaluated:", code);
  } catch (e) {
    console.error("eval error:", e);
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

function renderColorScreen(screen: ColorPattern, cyclePos: number, cycleNum: number) {
  const events = screen.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);
  if (!events.length) return;
  const currentColor = parseColor(events[0].value);
  ctx.fillStyle = `rgb(${currentColor[0] * 255}, ${currentColor[1] * 255}, ${currentColor[2] * 255})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function frame() {
  const now = performance.now() - startTime;
  const nowSec = now / 1000;
  const cyclePos = (nowSec * cyclesPerSecond) % 1;
  const cycleNum = Math.floor(nowSec * cyclesPerSecond);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // draw screens in order
  for (let i = 0; i < screens.length; i++) {
    const screen = screens[i];

    // resolve alpha for this screen
    if (screen.alphaPattern) {
      const alphaEvs = screen.alphaPattern.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);
      ctx.globalAlpha = alphaEvs.length ? Math.max(0, Math.min(1, Number(alphaEvs[0].value))) : 1;
    }

    if (screen instanceof ColorPattern) {
      renderColorScreen(screen, cyclePos, cycleNum);
    } else if (screen instanceof VideoPattern) {
      const videoResult = renderVideoFrame({
        videoPattern: screen,
        videoPool, canvas, ctx,
        now, dt: now - lastFrameTime,
        cyclePos, cycleNum,
        lastVideoVal: lastScreenVals[i] ?? null,
      });
      lastScreenVals[i] = videoResult.lastVideoVal;
    }

    ctx.globalAlpha = 1;
  }

  lastFrameTime = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- editor ---
setupEditor(document.getElementById("editor-wrap")!);
