/**
 * Auto-sizing + zero-footprint skip, exercised end-to-end.
 *
 * Renderer level: a reduced-resolution modulator pass renders into a
 * sub-viewport of a ladder-sized texture, and consumer lookups scale by
 * view/tex — displacement must be identical to a full-res modulator.
 *
 * Pipeline level: consumers that are fully offscreen skip the modulator pass
 * entirely (FBO never rendered, op dropped, no warnings); when the consumer
 * pops back onscreen the modulator is back the same frame (stateless).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeTile, withRenderer, readPixel } from "./webgl-test-helpers";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { stack } from "@strudel/core";
import { mini } from "@strudel/mini";
import {
  initRegistry, resetRegistry, collectScreens, getNamedScreenIndices,
} from "./pattern-registry";
import { AUTO_MOD_PREFIX } from "./renderer-interface";
import { flushWarnings, clearWarnings } from "./warnings";
import "./visual-controls";

const AUTO0 = `${AUTO_MOD_PREFIX}0`;
const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });

/** 100×100 canvas: left half red, right half blue. */
function redBlueCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 50, 100);
  ctx.fillStyle = '#00f'; ctx.fillRect(50, 0, 50, 100);
  return c;
}

describe("sub-viewport modulator pass (renderer level)", () => {
  it("reduced-res pass displaces identically to full-res (uvScale path)", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // 40×40 requested → ladder allocates 50×50, view 40×40, uvScale 0.8.
      // Modulator: left half WHITE, right half BLACK (in logical 0..1 space).
      renderer.beginOffscreen(AUTO0, false, 40, 40);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, x: 0.25, w: 0.5 }));
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 0, g: 0, b: 0 }, x: 0.75, w: 0.5 }));
      renderer.endFrame();
      renderer.endOffscreen();
      // Consumer: 0.4×0.4 tile centred; red|blue source; tile-space lookup.
      renderer.drawTile(makeTile({
        source: { kind: 'text', canvas: redBlueCanvas() },
        x: 0.5, y: 0.5, w: 0.4, h: 0.4, fit: 'fill',
        modSrc: AUTO0, modAmt: 0.5, modSpace: 'tile',
      }));
      renderer.endFrame();

      // Tile spans screen x 30..70. Local 0.4 (x=46): white → uv 0.4+0.25 →
      // 0.65 → BLUE (unmodulated would be red). Local 0.6 (x=54): black →
      // 0.6−0.25 → 0.35 → RED (unmodulated would be blue).
      const [r1, , b1] = readPixel(canvas, 46, 50);
      expect(b1).toBeGreaterThan(150);
      expect(r1).toBeLessThan(100);
      const [r2, , b2] = readPixel(canvas, 54, 50);
      expect(r2).toBeGreaterThan(150);
      expect(b2).toBeLessThan(100);

      // The allocation really is the 50×50 ladder step, not full-size.
      expect(renderer.getAutoFBOStats().bytes).toBe(50 * 50 * 4);
    });
  });
});

describe("zero-footprint skip (pipeline level)", () => {
  beforeEach(() => {
    resetRegistry();
    initRegistry();
    clearWarnings();
  });

  it("offscreen consumer skips the pass; pop-back renders it the same frame", () => {
    // Two-tone hidden layer as the consumer's source.
    stack(
      (color("red") as any).x(0.25).width(0.5),
      (color("blue") as any).x(0.75).width(0.5),
    ).p("Hsrc");
    // Consumer alternates fully-offscreen / onscreen each half cycle.
    // (mini() explicitly — tests bypass the transpiler's double-quote wrap.)
    (screen("src") as any).modulate(screen("white"), 0.5).x(mini("3 0.5")).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();

    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());

      // First half-cycle: x=3 → fully offscreen → modulator pass skipped, FBO
      // never even allocated.
      fr.render(screens as any, named, 0.25, 1, 0.25);
      expect(renderer.getAutoFBOStats().count).toBe(0);
      expect(fr.modSkipViolations).toBe(0);

      // Second half-cycle: x=0.5 → onscreen → modulated the same frame
      // (stateless FBO renders before its consumer).
      fr.render(screens as any, named, 0.75, 1, 0.75);
      expect(renderer.getAutoFBOStats().count).toBe(1);
      const [r, , b] = readPixel(canvas, 40, 50);
      expect(b).toBeGreaterThan(150); // white modulator: uv 0.4+0.25 → blue
      expect(r).toBeLessThan(100);
    });
    expect(flushWarnings()).toEqual([]);
    });

  it("default fullscreen consumer renders the modulator at full resolution", () => {
    stack(
      (color("red") as any).x(0.25).width(0.5),
      (color("blue") as any).x(0.75).width(0.5),
    ).p("Hsrc");
    (screen("src") as any).modulate(screen("white"), 0.5).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();

    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      // Full-res FBO (100×100) and correct displacement.
      expect(renderer.getAutoFBOStats().bytes).toBe(100 * 100 * 4);
      const [, , b] = readPixel(canvas, 40, 50);
      expect(b).toBeGreaterThan(150);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("grid of small tiles shrinks the shared modulator (the stackN case)", () => {
    stack(
      (color("red") as any).x(0.25).width(0.5),
      (color("blue") as any).x(0.75).width(0.5),
    ).p("Hsrc");
    // A single small consumer: 0.2×0.2 → required ≈ 20px → ladder 25×25.
    (screen("src") as any).modulate(screen("white"), 0.5).width(0.2).height(0.2).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();

    withRenderer((renderer) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      expect(renderer.getAutoFBOStats().bytes).toBe(25 * 25 * 4);
    });
    expect(flushWarnings()).toEqual([]);
  });
});
