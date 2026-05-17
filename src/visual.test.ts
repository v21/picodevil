/**
 * Visual tests: render patterns to a canvas and check pixel values.
 * Tests color rendering, alpha, stacking, grid layout, and scale.
 * Image/video/crop tests live in webgl-crop.test.ts.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { color as makeColor } from "./color-pattern";
import "./visual-controls";
import { index } from "./index-patterns";

// --- minimal render harness ---

const W = 100;
const H = 100;

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

/** Render a single event value. */
function renderEvent(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, ev: any): void {
  if (ev._type === "color") {
    const [r, g, b] = parseColor(ev.color);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/** Render a single screen at cycle time t. */
function renderScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, screen: any, t: number): void {
  const events = screen.queryArc(t, t);
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

    const px = ev.x !== undefined ? Number(ev.x) : undefined;
    const py = ev.y !== undefined ? Number(ev.y) : undefined;
    const pw = ev.width !== undefined ? Number(ev.width) : 1;
    const ph = ev.height !== undefined ? Number(ev.height) : 1;
    if (px !== undefined || py !== undefined || pw !== 1 || ph !== 1) {
      const cx = px ?? 0.5;
      const cy = py ?? 0.5;
      ctx.beginPath();
      ctx.rect((cx - pw / 2) * canvas.width, (cy - ph / 2) * canvas.height, pw * canvas.width, ph * canvas.height);
      ctx.clip();
      ctx.translate((cx - pw / 2) * canvas.width, (cy - ph / 2) * canvas.height);
      ctx.scale(pw, ph);
    }

    renderEvent(ctx, canvas, ev);

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** Render a stack of screens and return the canvas. */
function render(screens: any[], t = 0): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const { canvas, ctx } = makeCanvas();
  ctx.clearRect(0, 0, W, H);
  for (const screen of screens) renderScreen(ctx, canvas, screen, t);
  return { canvas, ctx };
}

/** Get pixel [r, g, b, a] at (x, y). */
function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function color(pat: string) { return makeColor(pat); }

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
      const g = index(color("red"), color("blue")).cols(2).rows(1).gridMod();
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 50)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 50)).toEqual([0, 0, 255, 255]);
    });

    it("1x2 grid splits vertically", () => {
      const g = index(color("red"), color("blue")).cols(1).rows(2).gridMod();
      const { ctx } = render([g]);
      expect(pixel(ctx, 50, 10)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 50, 90)).toEqual([0, 0, 255, 255]);
    });

    it("2x2 grid with 4 colors", () => {
      const g = index(color("red"), color("green"), color("blue"), color("yellow")).rowscols(2).gridMod();
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 10)).toEqual([255, 0, 0, 255]);
      const [r1, g1, b1] = pixel(ctx, 90, 10);
      expect(r1).toBe(0); expect(g1).toBe(128); expect(b1).toBe(0);
      expect(pixel(ctx, 10, 90)).toEqual([0, 0, 255, 255]);
      expect(pixel(ctx, 90, 90)).toEqual([255, 255, 0, 255]);
    });

    it("children cycle when fewer than cells", () => {
      const g = index(color("red"), color("blue")).rowscols(2).gridMod();
      const { ctx } = render([g]);
      expect(pixel(ctx, 10, 10)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 10)).toEqual([0, 0, 255, 255]);
      expect(pixel(ctx, 10, 90)).toEqual([255, 0, 0, 255]);
      expect(pixel(ctx, 90, 90)).toEqual([0, 0, 255, 255]);
    });

    it("dynamic grid size changes with time", () => {
      const g = index(color("red"), color("blue"), color("green")).cols(mini("2 3")).rows(1).gridMod();
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
});
