import { mini } from "@strudel/mini";
import type { Pattern } from "@strudel/mini";
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
import { setupEditor } from "./editor";
import { ColorPattern } from "./color-pattern";
import { VideoPattern } from "./video-pattern";
import { REVERSE_SEEK_INTERVAL, VIDEO_BASE, CYCLES_PER_SECOND } from "./config";
import { setPlaybackRate, isNativeRate } from "./playback-rate";
import { resolveTime } from "./time-value";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", resize);
resize();

// --- state ---
let pattern: Pattern = mini("red blue [green yellow] purple");
let cyclesPerSecond = CYCLES_PER_SECOND;

// --- video ---
let videoPattern: VideoPattern | null = null;
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
  videoPattern = vp;
  console.log("videoPattern set:", vp);
}

function clearVideos() {
  for (const el of videoPool.values()) {
    el.pause();
    el.removeAttribute("src");
  }
  videoPool.clear();
  videoPattern = null;
}

function color(pat: string): ColorPattern {
  clearVideos();
  return new ColorPattern(mini(pat), applyColor);
}

function setCps(cps: number) {
  cyclesPerSecond = cps;
}

function applyColor(cp: ColorPattern) {
  clearVideos();
  pattern = cp.pattern;
  console.log("pattern set:", cp.pattern);
}

// unit helpers: tag pattern values so parseTimeValue interprets them as seconds/ms
// Added as chainable methods on Pattern prototype for idiomatic Strudel usage
const PatternProto = Object.getPrototypeOf(sine);
PatternProto.sec = function () { return this.fmap((v: number) => v + "sec"); };
PatternProto.ms = function () { return this.fmap((v: number) => v + "ms"); };

// called from editor on ctrl+enter
window.uzuEval = (code: string) => {
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
let lastColorVal: string | null = null;
let lastVideoVal: string | null = null;

function frame() {
  const now = performance.now() - startTime;
  const nowSec = now / 1000;
  const cyclePos = (nowSec * cyclesPerSecond) % 1;
  const cycleNum = Math.floor(nowSec * cyclesPerSecond);

  // query the pattern for the current cycle
  const events = pattern.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);

  // find the "current" event (the one whose whole span contains now)
  let currentColor: [number, number, number] = [0, 0, 0];
  for (const ev of events) {
    currentColor = parseColor(ev.value);
    if (ev.value !== lastColorVal) {
      // console.log("color:", ev.value);
      lastColorVal = ev.value;
    }
    break;
  }

  ctx.fillStyle = `rgb(${currentColor[0] * 255}, ${currentColor[1] * 255}, ${currentColor[2] * 255})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // draw video frame from pattern
  if (videoPattern) {
    const vidEvents = videoPattern.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);
    for (const ev of vidEvents) {
      const { src, speed, start, end: endTV, endIsDuration } = ev.value;
      const videoKey = JSON.stringify({ src, speed, start, end: endTV, endIsDuration });
      if (videoKey !== lastVideoVal) {
        // console.log("video:", { src, speed, start, end: endTV, endIsDuration });
        lastVideoVal = videoKey;
      }
      const el = videoPool.get(src);
      if (el && isFinite(el.duration) && el.duration > 0) {
        const dt = now - lastFrameTime;
        const dur = el.duration;
        const loopStart = resolveTime(start, dur);
        const resolvedEnd = resolveTime(endTV, dur);
        const loopEnd = endIsDuration ? loopStart + resolvedEnd : resolvedEnd;
        const wrapped = loopStart > loopEnd; // loop wraps around clip boundary
        function inRange(t: number): boolean {
          if (wrapped) return t >= loopStart || t <= loopEnd;
          return t >= loopStart && t <= loopEnd;
        }

        function wrapForward(t: number): number {
          if (wrapped) {
            if (t >= dur) return t - dur;
            if (t > loopEnd && t < loopStart) return loopStart;
          } else {
            if (t >= loopEnd) return loopStart + (t - loopEnd);
          }
          return t;
        }

        function wrapBackward(t: number): number {
          if (wrapped) {
            if (t < 0) return dur + t;
            if (t > loopEnd && t < loopStart) return loopEnd;
          } else {
            if (t <= loopStart) return loopEnd - (loopStart - t);
          }
          return t;
        }

        if (speed < 0 || !isNativeRate(speed)) {
          if (!el.paused) el.pause();
          if (!el._reverseAcc) el._reverseAcc = 0;
          el._reverseAcc += dt;

          let target = el.currentTime;
          let needsSeek = false;

          if (speed === 0) {
            // scrub: pin to loopStart each frame so signals can drive position
            if (target !== loopStart) {
              target = loopStart;
              needsSeek = true;
            }
          } else if (!inRange(target)) {
            target = speed < 0 ? loopEnd : loopStart;
            needsSeek = true;
            el._reverseAcc = 0;
          } else if (el._reverseAcc >= REVERSE_SEEK_INTERVAL) {
            const seekDelta = (el._reverseAcc / 1000) * Math.abs(speed);
            if (speed < 0) {
              target = wrapBackward(target - seekDelta);
            } else {
              target = wrapForward(target + seekDelta);
            }
            needsSeek = true;
            el._reverseAcc = 0;
          }

          if (needsSeek && !el._seeking) el.currentTime = target;
        } else {
          el._reverseAcc = 0;
          if (el.paused) el.play().catch(e => { if ((e as DOMException).name !== "AbortError") throw e; });
          if (el.playbackRate !== speed) setPlaybackRate(el, speed);
          if (!inRange(el.currentTime)) {
            el.currentTime = loopStart;
          }
          // for native playback with wrapped range, handle the clip-end crossing
          if (wrapped && el.currentTime >= dur - 0.05) {
            el.currentTime = 0;
          }
          if (!wrapped && el.currentTime >= loopEnd) {
            el.currentTime = loopStart;
          }
        }
      }
      if (el && el.videoWidth > 0) {
        const vw = el.videoWidth;
        const vh = el.videoHeight;
        const cw = canvas.width;
        const ch = canvas.height;
        const scale = Math.max(cw / vw, ch / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(el, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      }
      break;
    }
  }

  lastFrameTime = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- editor ---
setupEditor(document.getElementById("editor-wrap")!);
