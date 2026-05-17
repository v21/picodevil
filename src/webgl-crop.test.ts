/**
 * WebGL crop / UV tests: verify that crop parameters (cropx, cropy, cropw, croph)
 * produce the correct pixel output through the production WebGL render path.
 *
 * Coordinate note: gl.readPixels uses bottom-left origin, so a screen pixel at
 * (x, y) in top-left CSS coords maps to readPixels(x, H-1-y, ...).
 */
import { describe, it, expect } from "vitest";
import { makeTile, renderTile, readPixel, W, H } from "./webgl-test-helpers";

/** Create a 100x100 canvas with the left half one color and the right half another. */
function makeHSplitCanvas(leftColor: string, rightColor: string): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const ctx = src.getContext("2d")!;
  ctx.fillStyle = leftColor;  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = rightColor; ctx.fillRect(W / 2, 0, W / 2, H);
  return src;
}

/** Create a 100x100 canvas with the top half one color and the bottom half another. */
function makeVSplitCanvas(topColor: string, bottomColor: string): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const ctx = src.getContext("2d")!;
  ctx.fillStyle = topColor;    ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = bottomColor; ctx.fillRect(0, H / 2, W, H / 2);
  return src;
}

describe("WebGL crop rendering", () => {
  describe("solid color source", () => {
    it("full-screen red tile renders red at center", () => {
      const canvas = renderTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      const [r, g, b, a] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(10);
      expect(b).toBeLessThan(10);
      expect(a).toBe(255);
    });
  });

  describe("crop left / right", () => {
    it("crop left half (cropx=0.25, cropw=0.5): center is red", () => {
      const src = makeHSplitCanvas("red", "blue");
      const canvas = renderTile(makeTile({
        source: { kind: 'text', canvas: src },
        cropx: 0.25, cropw: 0.5,
      }));
      const [r, , b] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(b).toBeLessThan(50);
    });

    it("crop right half (cropx=0.75, cropw=0.5): center is blue", () => {
      const src = makeHSplitCanvas("red", "blue");
      const canvas = renderTile(makeTile({
        source: { kind: 'text', canvas: src },
        cropx: 0.75, cropw: 0.5,
      }));
      const [r, , b] = readPixel(canvas, 50, 50);
      expect(b).toBeGreaterThan(200);
      expect(r).toBeLessThan(50);
    });
  });

  describe("flip", () => {
    it("cropw=-1 (horizontal flip): left pixel is blue, right pixel is red", () => {
      const src = makeHSplitCanvas("red", "blue");
      const canvas = renderTile(makeTile({
        source: { kind: 'text', canvas: src },
        cropw: -1,
      }));
      const [r1, , b1] = readPixel(canvas, 5, 50);
      expect(b1).toBeGreaterThan(200);
      expect(r1).toBeLessThan(50);
      const [r2, , b2] = readPixel(canvas, 95, 50);
      expect(r2).toBeGreaterThan(200);
      expect(b2).toBeLessThan(50);
    });

    it("croph=-1 (vertical flip): top pixel is bottom color, bottom pixel is top color", () => {
      const src = makeVSplitCanvas("red", "blue");
      const canvas = renderTile(makeTile({
        source: { kind: 'text', canvas: src },
        croph: -1,
      }));
      const [r1, , b1] = readPixel(canvas, 50, 5);
      expect(b1).toBeGreaterThan(200);
      expect(r1).toBeLessThan(50);
      const [r2, , b2] = readPixel(canvas, 50, 95);
      expect(r2).toBeGreaterThan(200);
      expect(b2).toBeLessThan(50);
    });
  });

  describe("default crop is identity", () => {
    it("cropx=0.5 cropw=1 renders the full source unchanged", () => {
      const src = makeHSplitCanvas("red", "blue");
      const canvas = renderTile(makeTile({
        source: { kind: 'text', canvas: src },
        cropx: 0.5, cropy: 0.5, cropw: 1, croph: 1,
      }));
      const [r1, , b1] = readPixel(canvas, 10, 50);
      expect(r1).toBeGreaterThan(200);
      expect(b1).toBeLessThan(50);
      const [r2, , b2] = readPixel(canvas, 90, 50);
      expect(b2).toBeGreaterThan(200);
      expect(r2).toBeLessThan(50);
    });
  });
});
