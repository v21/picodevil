/**
 * Visual tests: render patterns to a canvas and check pixel values.
 * Establishes baseline rendering behavior before the functional rewrite.
 *
 * Uses real DOM canvas + real <img>/<video> elements for image/video tests.
 * Test assets served from public/test-assets/ by Vite's dev server.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mini } from "@strudel/mini";
import { color as makeColor } from "./color-pattern";
import "./visual-controls";
import { image as makeImage } from "./image-pattern";
import { video as makeVideo } from "./video-pattern";
import { gridStack } from "./grid-stack";
import { drawFit } from "./draw-fit";
import { renderVideoFrame } from "./video-playback";

// --- minimal render harness ---

const W = 100;
const H = 100;

/** Test asset base URL — Vite serves public/ at root. */
const TEST_BASE = "/test-assets/";

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

/** Parse a CSS color string to [r, g, b] 0-255. */
const scratchCtx = document.createElement("canvas").getContext("2d")!;
function parseColor(val: string): [number, number, number] {
  scratchCtx.fillStyle = "#000";
  scratchCtx.fillStyle = val;
  const hex = scratchCtx.fillStyle;
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return [0, 0, 0];
}

/** Load an image and wait for it to be ready. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Load a video and wait for it to have a decodable frame. */
function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.addEventListener("canplaythrough", () => resolve(el), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${src}`)), { once: true });
    el.src = src;
    el.load();
  });
}

// --- image pool for tests ---
const imagePool = new Map<string, HTMLImageElement>();

/** Render a single event value. */
function renderEvent(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ev: any,
  opts: { imagePool?: Map<string, HTMLImageElement>; videoPool?: Map<string, HTMLVideoElement> } = {},
): void {
  if (ev._type === "color") {
    const [r, g, b] = parseColor(ev.color);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (ev._type === "image") {
    const base = ev.urlBase ?? TEST_BASE;
    const imgEl = (opts.imagePool ?? imagePool).get(base + ev.src);
    if (imgEl && imgEl.naturalWidth > 0) {
      const fitMode = ev.objectfit ?? "cover";
      drawFit(ctx, imgEl, imgEl.naturalWidth, imgEl.naturalHeight, canvas.width, canvas.height, fitMode);
    }
  } else if (ev._type === "video") {
    const pool = (opts.videoPool ?? new Map()) as Map<string, any>;
    const base = ev.urlBase ?? TEST_BASE;
    const el = pool.get(base + ev.src);
    if (el) {
      if (isFinite(el.duration) && el.duration > 0) {
        renderVideoFrame({ ev, el, currentCycle: 0, eventBegin: 0, cps: 0.5 });
      }
      if (el.videoWidth > 0) {
        const fitMode = ev.objectfit ?? "cover";
        drawFit(ctx, el, el.videoWidth, el.videoHeight, canvas.width, canvas.height, fitMode);
      }
    }
  }
}

/** Render a single screen at cycle time t. Mirrors main.ts renderScreen. */
function renderScreen(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  screen: any,
  t: number,
  opts: { imagePool?: Map<string, HTMLImageElement>; videoPool?: Map<string, HTMLVideoElement> } = {},
): void {
  const events = screen.queryArc(t, t + 0.001);
  if (!events.length) return;

  for (const hap of events) {
    const ev = hap.value;

    ctx.save();

    if (ev.alpha !== undefined) {
      ctx.globalAlpha = Math.max(0, Math.min(1, Number(ev.alpha)));
    }

    const sx = ev.scaleX !== undefined ? Number(ev.scaleX) : 1;
    const sy = ev.scaleY !== undefined ? Number(ev.scaleY) : 1;
    if (sx !== 1 || sy !== 1) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(sx, sy);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }

    // Position params (used by grid layout)
    const px = ev.x !== undefined ? Number(ev.x) : 0;
    const py = ev.y !== undefined ? Number(ev.y) : 0;
    const pw = ev.width !== undefined ? Number(ev.width) : 1;
    const ph = ev.height !== undefined ? Number(ev.height) : 1;
    if (px !== 0 || py !== 0 || pw !== 1 || ph !== 1) {
      ctx.beginPath();
      ctx.rect(px * canvas.width, py * canvas.height, pw * canvas.width, ph * canvas.height);
      ctx.clip();
      ctx.translate(px * canvas.width, py * canvas.height);
      ctx.scale(pw, ph);
    }

    renderEvent(ctx, canvas, ev, opts);

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** Render a stack of screens and return the canvas. */
function render(
  screens: any[],
  t = 0,
  opts: { imagePool?: Map<string, HTMLImageElement>; videoPool?: Map<string, HTMLVideoElement> } = {},
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const { canvas, ctx } = makeCanvas();
  ctx.clearRect(0, 0, W, H);
  for (const screen of screens) {
    renderScreen(ctx, canvas, screen, t, opts);
  }
  return { canvas, ctx };
}

/** Get pixel [r, g, b, a] at (x, y). */
function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function color(pat: string) {
  return makeColor(pat);
}

function image(pat: string) {
  return makeImage(pat).urlBase(TEST_BASE);
}

function video(pat: string) {
  return makeVideo(pat).urlBase(TEST_BASE);
}

// --- tests ---

describe("visual rendering", () => {
  describe("color", () => {
    it("solid red fills the canvas", () => {
      const { ctx } = render([color("red")]);
      expect(pixel(ctx, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 50, 50)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 99, 99)).toEqual([255, 0, 0, 255]);
    });

    it("solid blue fills the canvas", () => {
      const { ctx } = render([color("blue")]);
      expect(pixel(ctx, 50, 50)).toEqual([0, 0, 255, 255]);
    });

    it("hex color works", () => {
      const { ctx } = render([color("#ff00ff")]);
      expect(pixel(ctx, 50, 50)).toEqual([255, 0, 255, 255]);
    });

    it("pattern alternates across cycle", () => {
      const { ctx: ctx1 } = render([color("red blue")], 0.1);
      expect(pixel(ctx1, 50, 50)).toEqual([255, 0, 0, 255]);

      const { ctx: ctx2 } = render([color("red blue")], 0.6);
      expect(pixel(ctx2, 50, 50)).toEqual([0, 0, 255, 255]);
    });
  });

  describe("alpha", () => {
    it("alpha 0.5 over white background", () => {
      const { canvas, ctx } = makeCanvas();
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, W, H);
      renderScreen(ctx, canvas, color("red").alpha(0.5), 0);
      const [r, g, b] = pixel(ctx, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(100);
      expect(g).toBeLessThan(160);
      expect(b).toBeGreaterThan(100);
      expect(b).toBeLessThan(160);
    });

    it("alpha 0 makes color invisible", () => {
      const { canvas, ctx } = makeCanvas();
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, W, H);
      renderScreen(ctx, canvas, color("red").alpha(0), 0);
      const [r, g, b] = pixel(ctx, 50, 50);
      expect(r).toBe(255);
      expect(g).toBe(255);
      expect(b).toBe(255);
    });
  });

  describe("stacking", () => {
    it("later screen overlays earlier", () => {
      const { ctx } = render([color("red"), color("blue")]);
      expect(pixel(ctx, 50, 50)).toEqual([0, 0, 255, 255]);
    });

    it("semi-transparent overlay blends", () => {
      const { ctx } = render([color("red"), color("blue").alpha(0.5)]);
      const [r, g, b] = pixel(ctx, 50, 50);
      expect(r).toBeGreaterThan(100);
      expect(r).toBeLessThan(160);
      expect(g).toBe(0);
      expect(b).toBeGreaterThan(100);
      expect(b).toBeLessThan(160);
    });
  });

  describe("grid", () => {
    it("2x1 grid splits horizontally", () => {
      const g = gridStack([color("red"), color("blue")], 2, 1);
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 50)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 50)).toEqual([0, 0, 255, 255]);
    });

    it("1x2 grid splits vertically", () => {
      const g = gridStack([color("red"), color("blue")], 1, 2);
      const { ctx } = render([g]);
      expect(pixel(ctx, 50, 10)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 50, 90)).toEqual([0, 0, 255, 255]);
    });

    it("2x2 grid with 4 colors", () => {
      const g = gridStack(
        [color("red"), color("green"), color("blue"), color("yellow")],
        2, 2,
      );
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 10)).toEqual([255, 0, 0, 255]);
      const [r1, g1, b1] = pixel(ctx, 90, 10);
      expect(r1).toBe(0); expect(g1).toBe(128); expect(b1).toBe(0);
      expect(pixel(ctx, 10, 90)).toEqual([0, 0, 255, 255]);
      expect(pixel(ctx, 90, 90)).toEqual([255, 255, 0, 255]);
    });

    it("children cycle when fewer than cells", () => {
      const g = gridStack([color("red"), color("blue")], 2, 2);
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 10)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 10)).toEqual([0, 0, 255, 255]);
      expect(pixel(ctx, 10, 90)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 90)).toEqual([0, 0, 255, 255]);
    });

    it("dynamic grid size changes with time", () => {
      const g = gridStack([color("red"), color("blue"), color("green")], mini("2 3"), 1);
      const { ctx: ctx1 } = render([g], 0.1);
      expect(pixel(ctx1, 25, 50)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx1, 75, 50)).toEqual([0, 0, 255, 255]);

      const { ctx: ctx2 } = render([g], 0.6);
      expect(pixel(ctx2, 16, 50)).toEqual([255, 0, 0, 255]);
      const [r, g2, b] = pixel(ctx2, 50, 50);
      expect(r).toBe(0); expect(g2).toBe(0); expect(b).toBe(255);
    });
  });

  describe("scale", () => {
    it("scaleX 0.5 leaves edges transparent", () => {
      const { canvas, ctx } = makeCanvas();
      ctx.clearRect(0, 0, W, H);
      renderScreen(ctx, canvas, color("red").scaleX(0.5), 0);
      expect(pixel(ctx, 50, 50)).toEqual([255, 0, 0, 255]);
      const [, , , a] = pixel(ctx, 1, 50);
      expect(a).toBe(0);
      const [, , , a2] = pixel(ctx, 99, 50);
      expect(a2).toBe(0);
    });
  });

  // --- image rendering ---

  describe("image", () => {
    let redImg: HTMLImageElement;
    let blueImg: HTMLImageElement;
    const pool = new Map<string, HTMLImageElement>();

    beforeAll(async () => {
      redImg = await loadImage(TEST_BASE + "red.png");
      blueImg = await loadImage(TEST_BASE + "blue.png");
      pool.set(TEST_BASE + "red.png", redImg);
      pool.set(TEST_BASE + "blue.png", blueImg);
    });

    it("renders a red image", () => {
      const { ctx } = render([image("red.png")], 0, { imagePool: pool });
      const [r, g, b, a] = pixel(ctx, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(50);
      expect(b).toBeLessThan(50);
      expect(a).toBe(255);
    });

    it("renders a blue image", () => {
      const { ctx } = render([image("blue.png")], 0, { imagePool: pool });
      const [r, g, b, a] = pixel(ctx, 50, 50);
      expect(r).toBeLessThan(50);
      expect(g).toBeLessThan(50);
      expect(b).toBeGreaterThan(200);
      expect(a).toBe(255);
    });

    it("image pattern alternates across cycle", () => {
      const { ctx: ctx1 } = render([image("red.png blue.png")], 0.1, { imagePool: pool });
      const [r1] = pixel(ctx1, 50, 50);
      expect(r1).toBeGreaterThan(200);

      const { ctx: ctx2 } = render([image("red.png blue.png")], 0.6, { imagePool: pool });
      const [r2, , b2] = pixel(ctx2, 50, 50);
      expect(r2).toBeLessThan(50);
      expect(b2).toBeGreaterThan(200);
    });

    it("image with alpha blends over background", () => {
      const { canvas, ctx } = makeCanvas();
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, W, H);
      renderScreen(ctx, canvas, image("red.png").alpha(0.5), 0, { imagePool: pool });
      const [r, g, b] = pixel(ctx, 50, 50);
      // Red blended with white at ~50%
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(100);
      expect(b).toBeLessThan(160);
    });

    it("image in grid", () => {
      const g = gridStack([image("red.png"), image("blue.png")], 2, 1);
      const { ctx } = render([g], 0, { imagePool: pool });
      const [r1] = pixel(ctx, 10, 50);
      expect(r1).toBeGreaterThan(200);
      const [, , b2] = pixel(ctx, 90, 50);
      expect(b2).toBeGreaterThan(200);
    });
  });

  // --- video rendering ---

  describe("video", () => {
    let redVideo: HTMLVideoElement;
    let blueVideo: HTMLVideoElement;
    const pool = new Map<string, any>();

    beforeAll(async () => {
      redVideo = await loadVideo(TEST_BASE + "red.mp4");
      blueVideo = await loadVideo(TEST_BASE + "blue.mp4");
      // Pool keys mirror what getVideoEl produces: prefix + base + name
      pool.set(TEST_BASE + "red.mp4", redVideo);
      pool.set(TEST_BASE + "blue.mp4", blueVideo);
    });

    it("video elements loaded with dimensions", () => {
      // Fail loudly if test assets didn't load — all other video tests depend on this
      expect(redVideo.videoWidth).toBeGreaterThan(0);
      expect(blueVideo.videoWidth).toBeGreaterThan(0);
    });

    it("renders a red video frame", () => {
      const { canvas, ctx } = makeCanvas();
      drawFit(ctx, redVideo, redVideo.videoWidth, redVideo.videoHeight, W, H, "cover");
      const [r, g, b, a] = pixel(ctx, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(80);
      expect(b).toBeLessThan(80);
      expect(a).toBe(255);
    });

    it("renders a blue video frame", () => {
      const { canvas, ctx } = makeCanvas();
      drawFit(ctx, blueVideo, blueVideo.videoWidth, blueVideo.videoHeight, W, H, "cover");
      const [r, g, b, a] = pixel(ctx, 50, 50);
      expect(r).toBeLessThan(80);
      expect(g).toBeLessThan(80);
      expect(b).toBeGreaterThan(200);
      expect(a).toBe(255);
    });

    it("video renders through the full pipeline", () => {
      const vp = video("red.mp4");
      const { canvas, ctx } = makeCanvas();
      renderScreen(ctx, canvas, vp, 0, { videoPool: pool as any });
      const [r, , , a] = pixel(ctx, 50, 50);
      expect(a).toBe(255);
      expect(r).toBeGreaterThan(200);
    });

    it("video with alpha", () => {
      const { canvas, ctx } = makeCanvas();
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, W, H);
      renderScreen(ctx, canvas, video("red.mp4").alpha(0.5), 0, { videoPool: pool as any });
      const [r, g] = pixel(ctx, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeGreaterThan(50);
    });

    it("video in grid cell", () => {
      const g = gridStack([video("red.mp4"), color("blue")], 2, 1);
      const { ctx } = render([g], 0, { videoPool: pool as any });
      const [r1] = pixel(ctx, 10, 50);
      expect(r1).toBeGreaterThan(200);
      expect(pixel(ctx, 90, 50)).toEqual([0, 0, 255, 255]);
    });
  });
});
