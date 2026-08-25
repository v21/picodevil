/**
 * Full-pipeline `.matte` tests: registry → collectScreens → FrameRenderer →
 * real WebGL pixels. The webgl-matte tests drive `drawTile` directly, so this
 * is what actually exercises the renderer.ts plumbing — planModPasses keeping
 * the matte's auto-FBO alive and sized, buildTileParams stamping/guarding the
 * matte fields, and the `.render()` bake carrying them through a segment.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { stack } from "@strudel/core";
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

/** Hidden layer: left half white (keeps), right half black (masks out). */
function registerSplitMatte(name: string): void {
  stack(
    (color("white") as any).x(0.25).width(0.5),
    (color("black") as any).x(0.75).width(0.5),
  ).p(`H${name}`);
}

/** Render one frame through FrameRenderer and hand back the canvas reader. */
function renderFrames(n: number, probe: (canvas: HTMLCanvasElement) => void): void {
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  withRenderer((renderer, canvas) => {
    const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
    for (let i = 0; i < n; i++) fr.render(screens as any, named, 0, 1, 0);
    probe(canvas);
  });
}

beforeEach(() => {
  resetRegistry();
  initRegistry();
  clearWarnings();
});

describe("matte pipeline", () => {
  it("matte FBO content is current-frame when the consumer samples it", () => {
    registerSplitMatte("m");
    // Asserting on frame 1 pins the ordering: if the auto layer rendered AFTER
    // its consumer, the first frame would sample an empty FBO — which, with
    // premultiplied-luminance semantics, would mask the tile out ENTIRELY and
    // the left-hand probe below would read alpha 0.
    (color("red") as any).matte(screen("m")).p("$");
    renderFrames(1, (canvas) => {
      expect(readPixel(canvas, 25, 50)[3]).toBe(255); // white half → kept
      expect(readPixel(canvas, 75, 50)[3]).toBe(0);   // black half → masked
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("an inline matte source registers its own auto layer and renders it", () => {
    // No named layer at all — the matte is an inline expression.
    (color("red") as any)
      .matte((color("white") as any).x(0.25).width(0.5))
      .p("$");
    renderFrames(1, (canvas) => {
      expect(readPixel(canvas, 25, 50)[3]).toBe(255);
      // The inline matte never drew into the right half → transparent → masked.
      expect(readPixel(canvas, 75, 50)[3]).toBe(0);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("survives a .render() boundary (matte fields ride in a bake segment)", () => {
    registerSplitMatte("m");
    // matte BEFORE .render(): planModPasses must scan _bakeSegments, else the
    // auto FBO is skipped as unread and the matte silently does nothing.
    (color("red") as any).matte(screen("m")).render().p("$");
    renderFrames(1, (canvas) => {
      expect(readPixel(canvas, 25, 50)[3]).toBe(255);
      expect(readPixel(canvas, 75, 50)[3]).toBe(0);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("a matte with no visible consumer is skipped without warning", () => {
    registerSplitMatte("m");
    // Consumer scaled to nothing → zero footprint → the matte pass is skipped
    // and buildTileParams drops matteSrc. Must not trip the skip-violation warn.
    (color("red") as any).matte(screen("m")).width(0).height(0).p("$");
    renderFrames(1, () => {});
    expect(flushWarnings()).toEqual([]);
  });

  it("NaN matte amount warns and draws unmatted", () => {
    registerSplitMatte("m");
    (color("red") as any).matte(screen("m"), NaN).p("$");
    renderFrames(1, (canvas) => {
      // amount 0 → no-op → fully opaque on BOTH halves.
      expect(readPixel(canvas, 25, 50)[3]).toBe(255);
      expect(readPixel(canvas, 75, 50)[3]).toBe(255);
    });
    expect(flushWarnings().some(m => /NaN matte amount/.test(m))).toBe(true);
  });

  it("a matte source with NO events renders an empty FBO and hides the tile", () => {
    // The matte layer produces no events this frame (silence). Its pass must
    // still run, leaving a cleared (transparent) FBO — which, under the
    // premultiplied-luminance rule, reads as black and masks the tile out.
    // Before the empty-pass fix the FBO was never created at all and the tile
    // drew unmatted with an "FBO missing at draw time" internal warning.
    (color("red") as any).matte(screen("~")).p("$");
    renderFrames(1, (canvas) => {
      expect(readPixel(canvas, 50, 50)[3]).toBe(0);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("a matte source that is silent only SOME frames still renders its pass", () => {
    // "white ~" is present for the first half-cycle, silent for the second.
    // (White, not red: luminance keys the alpha, and red is only 0.2126.)
    (color("red") as any).matte(screen("white ~")).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();
    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0.25, 1, 0);   // matte present → visible
      expect(readPixel(canvas, 50, 50)[3]).toBe(255);
      fr.render(screens as any, named, 0.75, 1, 0);   // matte silent → hidden
      expect(readPixel(canvas, 50, 50)[3]).toBe(0);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("matte and modulate on one chain both resolve", () => {
    registerSplitMatte("m");
    // Grey modulator = no displacement, so the matte result is unchanged —
    // but both auto FBOs must be planned, rendered and bound (three units).
    (color("red") as any)
      .modulate(screen("grey"), 0.5)
      .matte(screen("m"))
      .p("$");
    renderFrames(1, (canvas) => {
      expect(readPixel(canvas, 25, 50)[3]).toBe(255);
      expect(readPixel(canvas, 75, 50)[3]).toBe(0);
    });
    expect(flushWarnings()).toEqual([]);
  });
});
