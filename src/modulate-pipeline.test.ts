/**
 * Full-pipeline `.modulate` tests: registry → collectScreens → FrameRenderer →
 * real WebGL pixels. Pins the two ordering guarantees the pattern-only API is
 * built on:
 *   1. An inline modulator's FBO holds CURRENT-frame content when its consumer
 *      samples it (auto layer registers, and therefore renders, first).
 *   2. Self-feedback (`Hq: s("x").modulate(s("q"), …)`) works through the
 *      standard forward-reference semantics — previous-frame content, no
 *      double-buffering, no warnings.
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
  snapshotRegistry, restoreRegistry,
} from "./pattern-registry";
import { withRenderer, readPixel } from "./webgl-test-helpers";
import { flushWarnings, clearWarnings } from "./warnings";
import "./visual-controls";

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });

/** Hidden two-tone layer: left half red, right half blue. */
function registerTwoTone(name: string): void {
  stack(
    (color("red") as any).x(0.25).width(0.5),
    (color("blue") as any).x(0.75).width(0.5),
  ).p(`H${name}`);
}

beforeEach(() => {
  resetRegistry();
  initRegistry();
  clearWarnings();
});

describe("modulate pipeline", () => {
  it("modulator FBO content is current-frame when the consumer samples it", () => {
    registerTwoTone("src");
    // White modulator → +amt/2 displacement. If the auto FBO rendered AFTER
    // its consumer, the very first frame would sample an empty FBO and show
    // no displacement — so asserting on frame 1 pins the ordering.
    (screen("src") as any).modulate(screen("white"), 0.5).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();

    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      fr.render(screens as any, named, 0, 1, 0);
      // uv.x at x=40 is 0.4; +0.25 → 0.65 → blue (unmodulated would be red).
      const [r, , b] = readPixel(canvas, 40, 50);
      expect(b).toBeGreaterThan(150);
      expect(r).toBeLessThan(100);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("self-feedback via forward reference: previous frame's content, no warnings", () => {
    registerTwoTone("src");
    // Hq's inline modulator references q itself. The auto layer renders before
    // Hq, so its s("q") read is a forward reference → previous-frame content.
    (screen("src") as any).modulate(screen("q"), 0.5).p("Hq");
    (screen("q") as any).p("$");
    const screens = collectScreens();
    const named = getNamedScreenIndices();

    withRenderer((renderer, canvas) => {
      const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
      // Frame 1: q doesn't exist yet when the modulator renders → blank
      // modulator → q = unmodulated two-tone; main canvas shows red at x=40.
      fr.render(screens as any, named, 0, 1, 0);
      const [r1] = readPixel(canvas, 40, 50);
      expect(r1).toBeGreaterThan(150);
      // Frame 2: the modulator now holds frame 1's q (red at 0.4 → rg=(1,0),
      // dx=+0.25) → uv 0.65 → blue.
      fr.render(screens as any, named, 0, 1, 0);
      const [r2, , b2] = readPixel(canvas, 40, 50);
      expect(b2).toBeGreaterThan(150);
      expect(r2).toBeLessThan(100);
    });
    expect(flushWarnings()).toEqual([]);
  });

  it("failed-eval style restore discards auto screens (registry snapshot)", () => {
    // Simulates EvalController's failure path: snapshot → new registrations →
    // restore. The auto layer registered after the snapshot must be gone.
    registerTwoTone("src");
    const screensBefore = collectScreens().length;
    const snap = snapshotRegistry();
    (screen("src") as any).modulate(screen("white"), 0.5).p("$");
    expect(collectScreens().length).toBe(screensBefore + 2);
    restoreRegistry(snap);
    expect(collectScreens().length).toBe(screensBefore);
  });
});
