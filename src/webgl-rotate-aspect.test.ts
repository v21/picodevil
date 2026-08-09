/**
 * rotateZ must be a *rigid* on-screen rotation — it preserves the source's
 * aspect ratio. The transform is built in clip space ([-1,1]² stretched onto the
 * viewport), so a raw clip-space R(θ) rotates *and* stretches by the viewport
 * aspect. buildTransform conjugates the rotation by the aspect (= rotate in pixel
 * space) to cancel that. On a square canvas the correction is a no-op, so these
 * tests use a 2:1 (non-square) target where the old bug was visible.
 */
import { describe, it, expect } from "vitest";
import { WebGLRenderer } from "./webgl-renderer";
import { makeTile } from "./webgl-test-helpers";
import type { TileParams } from "./renderer-interface";

const RW = 200, RH = 100; // 2:1 → aspect = 2

function renderWide(tiles: TileParams[]): { canvas: HTMLCanvasElement; renderer: WebGLRenderer } {
  const canvas = document.createElement("canvas");
  canvas.width = RW; canvas.height = RH;
  const renderer = new WebGLRenderer(canvas);
  renderer.resize(RW, RH);
  renderer.beginFrame();
  for (const t of tiles) renderer.drawTile(t);
  renderer.endFrame();
  return { canvas, renderer };
}

// gl.readPixels is bottom-left origin, so flip y.
function px(canvas: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const gl = canvas.getContext("webgl2")! as WebGL2RenderingContext;
  const buf = new Uint8Array(4);
  gl.readPixels(x, RH - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

const isRed = (p: [number, number, number, number]) => p[3] > 200 && p[0] > 200;
const isClear = (p: [number, number, number, number]) => p[3] < 40;

describe("rotateZ preserves aspect ratio (pixel-space rotation)", () => {
  it("keeps a pixel-square tile square after a 90° turn on a 2:1 canvas", () => {
    // Cell = 100px wide (0.5·200) × 100px tall (1.0·100): a square in pixels,
    // centred. A rigid 90° turn leaves it a 100×100 square at x∈[50,150],
    // y∈[0,100]. The old clip-space rotation stretched it to 200×50
    // (x∈[0,200], y∈[25,75]) — the anamorphic bug this fix removes.
    const tile = makeTile({
      source: { kind: "color", r: 1, g: 0, b: 0 },
      w: 0.5, h: 1, fit: "fill", rotateZ: 0.25,
    });
    const { canvas, renderer } = renderWide([tile]);
    try {
      // centre: red either way — sanity that the tile drew at all
      expect(isRed(px(canvas, 100, 50))).toBe(true);

      // side gutters: inside the square only under the bug's 200px-wide stretch
      expect(isClear(px(canvas, 30, 50))).toBe(true);
      expect(isClear(px(canvas, 170, 50))).toBe(true);

      // top/bottom bands: inside the (full-height) rigid square, but outside the
      // bug's 50px-tall band (y∈[25,75])
      expect(isRed(px(canvas, 100, 12))).toBe(true);
      expect(isRed(px(canvas, 100, 88))).toBe(true);
    } finally {
      renderer.dispose();
    }
  });

  it("does not stretch a 180° turn (aspect-neutral, guards the sin-term signs)", () => {
    // 180° is its own aspect-neutral check: the footprint is unchanged, so the
    // full-width half-height tile stays exactly that. Guards against a wrong
    // aspect factor leaking into the cos terms.
    const tile = makeTile({
      source: { kind: "color", r: 0, g: 1, b: 0 },
      w: 1, h: 0.5, fit: "fill", rotateZ: 0.5,
    });
    const { canvas, renderer } = renderWide([tile]);
    try {
      const isGreen = (p: [number, number, number, number]) => p[3] > 200 && p[1] > 200;
      // full width, centred half height: y∈[25,75]
      expect(isGreen(px(canvas, 10, 50))).toBe(true);
      expect(isGreen(px(canvas, 190, 50))).toBe(true);
      expect(isClear(px(canvas, 100, 10))).toBe(true);
      expect(isClear(px(canvas, 100, 90))).toBe(true);
    } finally {
      renderer.dispose();
    }
  });
});
