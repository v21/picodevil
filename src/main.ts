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

function getVideoEl(name: string): HTMLVideoElement {
  if (videoPool.has(name)) return videoPool.get(name)!;
  const el = document.createElement("video") as HTMLVideoElement & { _reverseAcc?: number; _seeking?: boolean };
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.src = VIDEO_BASE + name;
  el.addEventListener("loadeddata", () => console.log("video loaded:", name));
  el.addEventListener("seeking", () => { el._seeking = true; });
  el.addEventListener("seeked", () => { el._seeking = false; });
  el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
  videoPool.set(name, el);
  return el;
}

function video(pat: string): VideoPattern {
  const srcPattern = mini(pat);
  const probe = srcPattern.queryArc(0, 1);
  for (const ev of probe) getVideoEl(ev.value);
  return new VideoPattern(srcPattern, {}, mini, applyVideo);
}

function applyVideo(vp: VideoPattern) {
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
const COLORS: Record<string, [number, number, number]> = {
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  yellow: [1, 1, 0],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
  purple: [0.6, 0.2, 0.8],
  orange: [1, 0.5, 0],
  white: [1, 1, 1],
  black: [0, 0, 0],
  pink: [1, 0.4, 0.7],
};

function parseColor(val: string): [number, number, number] {
  if (typeof val === "string" && COLORS[val]) return COLORS[val];
  if (typeof val === "string" && val.startsWith("#") && val.length === 7) {
    return [
      parseInt(val.slice(1, 3), 16) / 255,
      parseInt(val.slice(3, 5), 16) / 255,
      parseInt(val.slice(5, 7), 16) / 255,
    ];
  }
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
