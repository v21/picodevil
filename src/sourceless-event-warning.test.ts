/**
 * A transform handed to sometimes/every/inside/… that returns something other than
 * a pattern leaves a sourceless event behind (Strudel's stack() reifies the stray
 * value). There's nothing to draw, so the tile goes black — warn with the fix
 * instead of dropping it silently.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mini } from "@strudel/mini";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { initRegistry, resetRegistry, collectScreens, getNamedScreenIndices } from "./pattern-registry";
import { withRenderer, readPixel } from "./webgl-test-helpers";
import { flushWarnings, clearWarnings } from "./warnings";
import { getPatternGlobals } from "./eval-sandbox";
import "./visual-controls";
import "./pattern-extensions";

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (name: string) => name });

/** Render one frame of the registered screens; return warnings + centre-pixel alpha. */
function renderOnce(): { msgs: string[]; alpha: number } {
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  let alpha = 0;
  withRenderer((renderer, canvas) => {
    const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
    fr.render(screens as any, named, 0, 1, 0);
    alpha = readPixel(canvas, 50, 50)[3];
  });
  return { msgs: flushWarnings(), alpha };
}

beforeEach(() => {
  resetRegistry();
  initRegistry();
  clearWarnings();
});

describe("sourceless event warnings", () => {
  it("names the method when a wrapper is passed bare instead of applied", () => {
    const g: any = getPatternGlobals();
    (color(mini("red")) as any).sometimesBy(1, g.fast).p("$");
    const { msgs } = renderOnce();
    expect(msgs.some((m) => m.includes("fast(") && m.includes("x => x.fast("))).toBe(true);
  });

  it("explains a transform that returned a non-pattern", () => {
    (color(mini("red")) as any).sometimesBy(1, () => 5).p("$");
    const { msgs } = renderOnce();
    expect(msgs.some((m) => m.includes("didn't return a pattern"))).toBe(true);
  });

  it("a bare zero-arg transform draws, without warnings", () => {
    const g: any = getPatternGlobals();
    (color(mini("red blue")) as any).sometimesBy(1, g.rev).p("$");
    const { msgs, alpha } = renderOnce();
    expect(msgs).toEqual([]);
    expect(alpha).toBeGreaterThan(200);
  });
});
