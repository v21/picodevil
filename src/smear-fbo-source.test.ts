/**
 * Regression: `.smear()` on a `.render()`/FBO source must behave like a smear on
 * a raw element source. Two bugs, both from the smear running in the FBO's
 * flipped, sub-viewport-packed texture space:
 *
 *  - DIRECTION: FBO textures are V-flipped, so the smear's per-tap offset must
 *    follow that flip. It was fed Math.abs(uvSize), so a baked source smeared the
 *    opposite vertical direction from a raw element (a ↘ streak became ↗).
 *  - WRAPPING: a footprint-sized bake renders into the bottom-left sub-viewport
 *    [0,fboScale] of a pooled texture; the smear's fract() wrapped to the whole
 *    [0,1] texture, reading the un-rendered/stale region past the sub-viewport
 *    (transparent bleed / stale garbage). Taps now wrap within [0,fboScale].
 */
import { describe, it, expect } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { color } from "./color-pattern";
import { screen } from "./screen-pattern";
import { initRegistry, resetRegistry, collectScreens, getNamedScreenIndices } from "./pattern-registry";
import { makeTile, renderTile, withRenderer, readPixel } from "./webgl-test-helpers";
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
const R = (c: HTMLCanvasElement, x: number, y: number) => readPixel(c, x, y)[0];
const A = (c: HTMLCanvasElement, x: number, y: number) => readPixel(c, x, y)[3];

// small opaque white square, centre 40..60, transparent elsewhere
function squareCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const x = c.getContext("2d")!;
  x.clearRect(0, 0, 100, 100);
  x.fillStyle = "#ffffff"; x.fillRect(40, 40, 20, 20);
  return c;
}

describe("smear on a .render()/FBO source", () => {
  const ANG = 0.125, PXD = 12; // 45° diagonal: d1 = (+,+) → down-right streak

  it("smear direction matches a raw element (no V-flip inversion)", () => {
    // element source = reference: a 45° smear streaks the square down-right, so
    // the down-right lobe (65,65) is bright and the up-right lobe (65,35) is dark.
    const el = renderTile(makeTile({
      source: { kind: 'text', canvas: squareCanvas() }, fit: 'fill',
      smear: PXD, smearAngle: ANG, smearJitter: 0,
    }));
    const elDR = R(el, 65, 65), elUR = R(el, 65, 35);
    expect(elDR).toBeGreaterThan(elUR + 30); // element streaks down-right

    // FBO source (via render) must streak the SAME way.
    renderScreens(() => {
      (color("white") as any).x(0.5).y(0.5).w(0.2).h(0.2).p("Hsq");
      (screen("sq") as any).render().smear(ANG, PXD, 0).p("$");
    }, (c) => {
      const dr = R(c, 65, 65), ur = R(c, 65, 35);
      expect(dr).toBeGreaterThan(ur + 30);   // same down-right streak, not flipped
    });
  });

  it("smear on a footprint bake wraps within the sub-viewport (no transparent bleed)", () => {
    // Fully-opaque white FBO at width .6 → 60px footprint, ladder texture 100px →
    // fboScale 0.6 (a real sub-viewport). A strong horizontal smear: every tap
    // must land on opaque content, so alpha stays 255 across the tile. The old
    // fract([0,1]) pulled the transparent un-rendered region → alpha < 230.
    renderScreens(() => {
      (color("white") as any).p("Hwh");
      (screen("wh") as any).width(0.6).render().smear(0, 24, 0).p("$");
    }, (c) => {
      // tile spans screen x 20..80; check edges and centre
      for (const x of [21, 28, 50, 72, 79]) {
        expect(A(c, x, 50)).toBeGreaterThan(250);
      }
    });
  });
});
