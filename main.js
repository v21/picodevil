import { mini } from "@strudel/mini";
import { setupEditor } from "./editor.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", resize);
resize();

// --- state ---
let pattern = mini("red blue [green yellow] purple");
let cyclesPerSecond = 0.5;

// --- video ---
const VIDEO_BASE = "http://localhost:3456/videos/";
let videoPattern = null;
const videoPool = new Map(); // name -> <video> element

function getVideoEl(name) {
  if (videoPool.has(name)) return videoPool.get(name);
  const el = document.createElement("video");
  el.loop = true;
  el.muted = true;
  el.playsInline = true;
  el.src = VIDEO_BASE + name;
  el.play();
  videoPool.set(name, el);
  return el;
}

function video(pat) {
  videoPattern = mini(pat);
  // pre-create video elements for all unique sources
  const probe = videoPattern.queryArc(0, 1);
  for (const ev of probe) getVideoEl(ev.value);
  return videoPattern;
}

function clearVideos() {
  for (const el of videoPool.values()) {
    el.pause();
    el.removeAttribute("src");
  }
  videoPool.clear();
  videoPattern = null;
}

function color(pat) {
  clearVideos();
  return mini(pat);
}

// called from editor on ctrl+enter
window.uzuEval = (code) => {
  try {
    const result = new Function("mini", "color", "video", code)(
      mini,
      color,
      video,
    );
    if (result && typeof result.queryArc === "function") {
      pattern = result;
    }
    console.log("evaluated:", code);
  } catch (e) {
    console.error("eval error:", e);
  }
};

// --- color lookup ---
const COLORS = {
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

function parseColor(val) {
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
const startTime = performance.now() / 1000;

function frame() {
  const now = performance.now() / 1000 - startTime;
  const cyclePos = (now * cyclesPerSecond) % 1;
  const cycleNum = Math.floor(now * cyclesPerSecond);

  // query the pattern for the current cycle
  const events = pattern.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);

  // find the "current" event (the one whose whole span contains now)
  let color = [0, 0, 0];
  for (const ev of events) {
    color = parseColor(ev.value);
    break;
  }

  ctx.fillStyle = `rgb(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // draw video frame from pattern
  if (videoPattern) {
    const vidEvents = videoPattern.queryArc(cycleNum + cyclePos, cycleNum + cyclePos + 0.001);
    for (const ev of vidEvents) {
      const el = videoPool.get(ev.value);
      if (el && el.readyState >= 2) {
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

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- editor ---
setupEditor(document.getElementById("editor-wrap"));
