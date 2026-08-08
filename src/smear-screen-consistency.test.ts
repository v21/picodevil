/**
 * Regression: `.smear()` width must be screen-constant regardless of the
 * on-screen footprint a `.render()` bake is sized to.
 *
 * The bug: `.render()` bakes a tile into a footprint-sized FBO (reqW ≈ wFrac·cw).
 * The smear's per-tap offset is resolved CPU-side from the cell's screen-pixel
 * width; that width was taken from the full canvas (`this.w`) even inside the
 * reduced sub-viewport, so a smaller footprint (cropStack, scale, width) baked a
 * proportionally *narrower* smear that then placed 1:1 — visibly wrong. The fix
 * derives the cell width from the active render target's viewport
 * (`currentViewW`), so a footprint bake is a faithful footprint render.
 *
 * We reduce the footprint with `.width()` (same footprint-bake path as the
 * reported `cropStack` repro) but keep a single centred edge at screen x=50 that
 * a ramp measurement can read. Jitter is 0 for determinism.
 */
import { describe, it, expect } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { stack } from "@strudel/core";
import { initRegistry, resetRegistry, collectScreens, getNamedScreenIndices } from "./pattern-registry";
import { withRenderer, readPixel, W } from "./webgl-test-helpers";
import "./visual-controls";
import "./pattern-extensions";

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (n: string) => n });
function renderScreens(build: () => void, fn: (c: HTMLCanvasElement) => void): void {
  resetRegistry(); initRegistry();
  build();
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  withRenderer((renderer, canvas) => {
    const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
    fr.render(screens as any, named, 0, 1, 0);
    fn(canvas);
  });
}

// Vertical hard edge FBO: white left half, black right half → edge at screen x=50.
function edgeLayer() {
  (stack(
    (color("white") as any).x(0.25).w(0.5),
    (color("black") as any).x(0.75).w(0.5),
  ) as any).p("Hedge");
}

// Horizontal smear ramp width around the edge at x=50 (jitter=0 → deterministic):
// last x that is still ~white (>220) to the first x that is ~black (<30).
function rampWidth(c: HTMLCanvasElement, edge = 50): number {
  let xW = edge;
  for (let x = edge; x >= 0; x--) { if (readPixel(c, x, 50)[0] > 220) { xW = x; break; } }
  let xB = edge;
  for (let x = edge; x < W; x++) { if (readPixel(c, x, 50)[0] < 30) { xB = x; break; } }
  return xB - xW;
}

function ramp(build: () => void): number {
  let out = 0;
  renderScreens(build, (c) => { out = rampWidth(c); });
  return out;
}

describe("smear screen-consistency across .render() footprint", () => {
  const PX = 8; // small enough that even a 1/3-width tile contains the full ramp

  it("smear ramp is footprint-independent (full vs width-reduced bakes)", () => {
    const full = ramp(() => { edgeLayer(); (screen("edge") as any).smear(0, PX, 0).render().p("$"); });
    const half = ramp(() => { edgeLayer(); (screen("edge") as any).smear(0, PX, 0).width(0.5).render().p("$"); });
    const third = ramp(() => { edgeLayer(); (screen("edge") as any).smear(0, PX, 0).width(1 / 3).render().p("$"); });

    // Sanity: a real smear must be much wider than a hard edge (~1px).
    expect(full).toBeGreaterThan(8);

    // The reduced-footprint bakes must smear the same screen width as the full
    // one. Before the fix these were ~0.5×/0.4× (footprint-proportional). Ratios
    // are more portable across GPUs than absolute pixel counts.
    for (const r of [half, third]) {
      expect(r / full).toBeGreaterThan(0.7);
      expect(r / full).toBeLessThan(1.4);
    }
  });

  it("baking a full-frame smear is neutral (bake ≈ direct draw)", () => {
    const direct = ramp(() => { edgeLayer(); (screen("edge") as any).smear(0, PX, 0).p("$"); });
    const baked = ramp(() => { edgeLayer(); (screen("edge") as any).smear(0, PX, 0).render().p("$"); });
    expect(baked / direct).toBeGreaterThan(0.7);
    expect(baked / direct).toBeLessThan(1.4);
  });
});
