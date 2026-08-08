/**
 * Regression: `.render()` must be a transparent resampling boundary — baking a
 * source and drawing it back should match drawing the source directly.
 *
 * It wasn't, for sources with partially-transparent / antialiased edges (video,
 * PNG, text): the bake composites source-over into a transparent FBO, so the FBO
 * stores **premultiplied** rgb (rgb·a). Sampling that FBO back and compositing
 * again (SRC_ALPHA blend) multiplied by alpha a *second* time — every edge pixel
 * came out at rgb·a² instead of rgb·a, darkening/eroding edges (visible flicker
 * under `every(2, x=>x.render())`). Fix: FBO samples are un-premultiplied back to
 * straight alpha on read (`sourceIsFbo`). Opaque content (a=1) is unaffected.
 */
import { describe, it, expect } from "vitest";
import { FrameRenderer } from "./renderer";
import { createMetrics } from "./frame-metrics";
import { createVideoPoolManager } from "./video-pool-manager";
import { text } from "./text-pattern";
import { initRegistry, resetRegistry, collectScreens, getNamedScreenIndices } from "./pattern-registry";
import { withRenderer, W, H } from "./webgl-test-helpers";
import "./visual-controls";
import "./pattern-extensions";
import "./text-pattern";

const makePool = () => createVideoPoolManager({ resolveMediaUrl: (n: string) => n });
function grab(build: () => void): Uint8Array {
  resetRegistry(); initRegistry();
  build();
  const screens = collectScreens();
  const named = getNamedScreenIndices();
  const out = new Uint8Array(W * H * 4);
  withRenderer((renderer, canvas) => {
    const fr = new FrameRenderer(renderer, makePool() as any, createMetrics());
    fr.render(screens as any, named, 0, 1, 0);
    const gl = canvas.getContext('webgl2')!;
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
  });
  return out;
}
// mean per-pixel channel-sum abs difference over the frame
function meanDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
           Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
  }
  return sum / (a.length / 4);
}

// text glyph = an element source with antialiased (partial-alpha) edges.
const glyph = (fit: string, extra: (p: any) => any = (p) => p) => () =>
  extra((text('N') as any).objectfit(fit)).p("$");

describe("render() is transparent (premultiplied-alpha bake)", () => {
  for (const fit of ['fill', 'cover'] as const) {
    it(`bare .render() on an alpha-edged ${fit} source ≈ direct`, () => {
      const direct = grab(glyph(fit));
      const baked = grab(glyph(fit, (p) => p.render()));
      expect(meanDiff(direct, baked)).toBeLessThan(1); // was 2.9–4.5 (edges at rgb·a²)
    });

    it(`.render().smear() on an alpha-edged ${fit} source ≈ direct .smear()`, () => {
      const direct = grab(glyph(fit, (p) => p.smear(0, 20, 0)));
      const baked = grab(glyph(fit, (p) => p.render().smear(0, 20, 0)));
      expect(meanDiff(direct, baked)).toBeLessThan(1);
    });
  }
});
