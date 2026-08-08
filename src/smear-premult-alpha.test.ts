/**
 * Regression: `.smear()` must filter in premultiplied alpha so transparent taps
 * (rgb≈0) don't darken the opaque side of an alpha edge (dark fringe / halo).
 *
 * The canvas holds premultiplied output (blend writes rgb·a), so the straight
 * source colour on the opaque side is red_byte/alpha_byte. Across a hard
 * white→transparent edge, correct premultiplied filtering keeps that ratio ≈255
 * (white) on the opaque side; the old straight average pulled it well below 255
 * (measured ~176 → a visible dark fringe).
 */
import { describe, it, expect } from "vitest";
import { makeTile, renderTile, readPixel, withRenderer, W } from "./webgl-test-helpers";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { initRegistry, resetRegistry, collectScreens, getNamedScreenIndices } from "./pattern-registry";
import "./visual-controls";
import "./pattern-extensions";

// Left half opaque white, right half fully transparent (rgba 0,0,0,0).
// Hard alpha edge at source x=0.5 → screen x=50 under fill fit.
function alphaEdgeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 100, 100);               // right half stays transparent
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 50, 100);                 // left half opaque white
  return c;
}

// Un-premultiplied red on the canvas: framebuffer stores rgb·a, alpha stores a.
function unpremultRed(c: HTMLCanvasElement, x: number, y = 50): number {
  const [r, , , a] = readPixel(c, x, y);
  return a === 0 ? 0 : (r * 255) / a;
}

const PX = 10; // taps reach ±2·(PX/100)·1 ≈ ±20px across the edge
// Opaque side, inside the smear's reach of the edge, where alpha is partial.
const OPAQUE_XS = [40, 44, 47];

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (n: string) => n });

describe("smear premultiplied-alpha (no dark fringe at transparent edges)", () => {
  it("opaque side of a white→transparent edge stays white (plain source)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'text', canvas: alphaEdgeCanvas() },
      fit: 'fill', smear: PX, smearAngle: 0, smearJitter: 0,
    }));
    for (const x of OPAQUE_XS) {
      const [, , , a] = readPixel(canvas, x, 50);
      expect(a).toBeGreaterThan(0);       // within the tile
      expect(a).toBeLessThan(255);        // and within the smear's partial-alpha band
      expect(unpremultRed(canvas, x)).toBeGreaterThan(235); // ~white, no dark fringe
    }
  });

  it("opaque side stays white through a .render() bake (transparent letterbox)", () => {
    // A hidden FBO layer white on the left half, undrawn (transparent) on the
    // right. Baking it then smearing across the boundary is the "smear/render"
    // case: the bake FBO carries transparent regions that must not bleed dark.
    resetRegistry(); initRegistry();
    (color("white") as any).x(0.25).w(0.5).p("Haedge");
    (screen("aedge") as any).render().smear(0, PX, 0).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();
    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      for (const x of OPAQUE_XS) {
        expect(unpremultRed(canvas, x)).toBeGreaterThan(235);
      }
    });
  });

  it("fully-opaque source is unaffected by the premult change (no-op)", () => {
    // white/black opaque edge: no transparency, premult average == straight avg.
    const c = document.createElement("canvas");
    c.width = 100; c.height = 100;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 50, 100);
    ctx.fillStyle = "#000000"; ctx.fillRect(50, 0, 50, 100);
    const canvas = renderTile(makeTile({
      source: { kind: 'text', canvas: c },
      fit: 'fill', smear: PX, smearAngle: 0, smearJitter: 0,
    }));
    // Opaque everywhere; far-left saturates white, edge blends to grey.
    for (const x of [20, 50, 60]) expect(readPixel(canvas, x, 50)[3]).toBe(255);
    expect(readPixel(canvas, 20, 50)[0]).toBeGreaterThan(250); // far left = white
    expect(readPixel(canvas, 50, 50)[0]).toBeGreaterThan(30);  // edge = grey (not white/black)
    expect(readPixel(canvas, 50, 50)[0]).toBeLessThan(180);
  });
});
