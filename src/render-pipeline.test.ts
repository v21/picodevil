/**
 * Full-pipeline `.render()` — meta-effect model: bake segments expanded into
 * per-tile FBO chains at draw time. Registry → collectScreens → FrameRenderer →
 * real WebGL pixels.
 *
 * Proves: confinement (effects after render respect the tile's frame), correct
 * placement/orientation, the collapse case (two same-field effects both apply
 * across the boundary), and chaining.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import {
  initRegistry, resetRegistry, collectScreens, getNamedScreenIndices,
} from "./pattern-registry";
import { withRenderer, readPixel } from "./webgl-test-helpers";
import { flushWarnings, clearWarnings } from "./warnings";
import "./visual-controls";

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });

/** Register the code, render one frame, run assertions inside the GL context. */
function renderOnce(fn: (canvas: HTMLCanvasElement, r: any) => void): void {
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  withRenderer((renderer, canvas) => {
    const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
    fr.render(screens as any, named, 0, 1, 0);
    fn(canvas, renderer);
  });
}

const opaque = (a: number) => a > 200;
const transparent = (a: number) => a < 40;

beforeEach(() => {
  resetRegistry();
  initRegistry();
  clearWarnings();
});

describe("render pipeline (meta-effect)", () => {
  it("a full-frame render places content across the whole canvas", () => {
    (color("red") as any).grey(1).render().p("$");
    renderOnce((canvas) => {
      const [r, g, b, a] = readPixel(canvas, 50, 50);
      expect(opaque(a)).toBe(true);
      // grey(1) baked → desaturated red (R=G=B), not pure red
      expect(Math.abs(r - g)).toBeLessThan(8);
      expect(Math.abs(g - b)).toBeLessThan(8);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("confinement: a half-size tile draws only within its frame", () => {
    (color("white") as any).width(0.5).height(0.5).render().p("$");
    renderOnce((canvas) => {
      // centre is inside the .5×.5 tile → opaque white
      expect(opaque(readPixel(canvas, 50, 50)[3])).toBe(true);
      // (10,50) is at x=0.1, outside the tile's [0.25,0.75] span → transparent
      expect(transparent(readPixel(canvas, 10, 50)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 90, 50)[3])).toBe(true);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("a smear AFTER render stays inside the tile frame (the ducks case)", () => {
    // A big horizontal smear on a half-size tile: the smear operates in the
    // tile's own space, bounded by its dest rect — it must not paint outside
    // the [0.25,0.75] frame even though it blurs hard.
    (color("white") as any).width(0.5).height(0.5).render().smear(0, 12).p("$");
    renderOnce((canvas) => {
      expect(readPixel(canvas, 50, 50)[3]).toBeGreaterThan(150); // inside: content present
      expect(transparent(readPixel(canvas, 8, 50)[3])).toBe(true);  // well left of frame
      expect(transparent(readPixel(canvas, 92, 50)[3])).toBe(true); // well right of frame
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("placement + orientation: a top tile bakes to the top (Y not flipped)", () => {
    (color("white") as any).y(0.25).width(0.5).height(0.5).render().p("$");
    renderOnce((canvas) => {
      // tile spans y ∈ [0,0.5] → top area opaque, bottom transparent
      expect(opaque(readPixel(canvas, 50, 25)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 50, 80)[3])).toBe(true);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("genuine second pass: brightness applies twice across the boundary", () => {
    // #808080 ≈ 0.5. Baked +0.3 → 0.8; final samples 0.8 and adds 0.3 → clamps
    // white. Without the boundary the two calls collapse (+0.3 once) → ~204.
    (color("#808080") as any).brightness(0.3).render().brightness(0.3).p("$");
    renderOnce((canvas) => {
      const [r] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(240);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("control: two brightness without render collapse to one pass (~204)", () => {
    (color("#808080") as any).brightness(0.3).brightness(0.3).p("$");
    renderOnce((canvas) => {
      const [r] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(180);
      expect(r).toBeLessThan(230);
    });
  });

  it("chaining: two render() boundaries stack three brightness passes", () => {
    // 0.5 → +0.2 (bake0) = 0.7 → +0.2 (bake1) = 0.9 → +0.2 (final) = 1.1 → white.
    (color("#808080") as any).brightness(0.2).render().brightness(0.2).render().brightness(0.2).p("$");
    renderOnce((canvas) => {
      const [r] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(240);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("post-render grey desaturates the baked colour", () => {
    (color("red") as any).render().grey(1).p("$");
    renderOnce((canvas) => {
      const [r, g, b] = readPixel(canvas, 50, 50);
      expect(Math.abs(r - g)).toBeLessThan(8);
      expect(Math.abs(g - b)).toBeLessThan(8);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("composes with modulate: a modulator before render() is not skipped", () => {
    // modSrc lands inside the bake segment; the modulator FBO must still render
    // (the tile is its consumer). Both auto FBOs — modulator + render bake —
    // should be live after the frame.
    (color("red") as any).modulate(screen("white"), 0.3).render().p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();
    withRenderer((renderer) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      // one __auto_mod_* (the modulator) + one __auto_render_* (the bake) = 2
      expect(renderer.getAutoFBOStats().count).toBe(2);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("auto-sizes the bake FBO to the tile footprint, not the canvas", () => {
    // 0.25×0.25 tile on a 100×100 canvas → 25px footprint → ladder step 25.
    (color("white") as any).width(0.25).height(0.25).grey(1).render().p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();
    withRenderer((renderer) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      // 25×25×4 = 2500 bytes, vs 40000 for a canvas-sized bake.
      expect(renderer.getAutoFBOStats().bytes).toBe(25 * 25 * 4);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("sub-viewport (fractional su) still places + confines correctly", () => {
    // 0.3 footprint → 30px req → ladder 50 → viewport 30 inside a 50 texture,
    // su = 0.6. Positioned off-centre to also exercise placement + orientation.
    (color("white") as any).x(0.3).y(0.3).width(0.3).height(0.3).render().smear(0, 8).p("$");
    renderOnce((canvas, renderer) => {
      // content sits at (0.3,0.3) → pixel (30,30) opaque; opposite corner empty
      expect(readPixel(canvas, 30, 30)[3]).toBeGreaterThan(150);
      expect(transparent(readPixel(canvas, 80, 80)[3])).toBe(true);
      // ladder allocation is 50×50 (not exact 30, not canvas 100)
      expect(renderer.getAutoFBOStats().bytes).toBe(50 * 50 * 4);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("barrel AFTER render is centred on the tile, not the ladder texture", () => {
    // Regression for the off-centre bake bug: a 0.3 footprint bakes into a 30px
    // sub-viewport of a 50px ladder texture (su=0.6). A UV effect must run in the
    // tile's own [0,1] frame — so barrel centres on the tile centre and its
    // corners clip symmetrically. The old source-space barrel centred on the
    // texture's 0.5 (local ~0.83, toward one corner) and blew out lopsided.
    (color("white") as any).width(0.3).height(0.3).render().barrel(6).p("$");
    renderOnce((canvas) => {
      // Tile is centred (0.5,0.5), spans screen [35,65]. Centre opaque (barrel
      // neutral point), all four corners pushed out of [0,1] → transparent.
      expect(opaque(readPixel(canvas, 50, 50)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 37, 37)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 63, 37)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 37, 63)[3])).toBe(true);
      expect(transparent(readPixel(canvas, 63, 63)[3])).toBe(true);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("baked FBOs are swept when the render line disappears", () => {
    (color("red") as any).grey(1).render().p("$");
    const s1 = collectScreens();
    const n1 = getNamedScreenIndices();
    withRenderer((renderer) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(s1 as any, n1, 0, 1, 0);
      expect(renderer.getAutoFBOStats().count).toBe(1);

      resetRegistry();
      color("blue").p("$");
      const s2 = collectScreens();
      const n2 = getNamedScreenIndices();
      fr.render(s2 as any, n2, 0, 1, 0);
      const stats = renderer.getAutoFBOStats();
      expect(stats.count).toBe(0);
      expect(stats.pooled).toBe(1);
    });
  });
});
