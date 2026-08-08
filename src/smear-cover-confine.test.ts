/**
 * Regression: a `.smear()` must be confined to the *visible* crop window, so a
 * `.render()` bake (which discards the off-screen overflow) stays transparent.
 *
 * A cover/crop source hides part of the texture (the overflow). The old smear
 * sampled the whole texture (`fract` over [0,1]), so it pulled that hidden
 * overflow in at the visible edges. A `.render()` bake captures only the visible
 * crop, so its smear can't reach the overflow → the two diverged at the crop
 * edges (and jitter scattered the mismatch across the frame). Now every tap wraps
 * within the visible window (`OP_WRAP` sets it), so direct == render.
 */
import { describe, it, expect } from "vitest";
import { makeTile, readPixel, withRenderer, W, H } from "./webgl-test-helpers";
import type { TileParams } from "./renderer-interface";

// 300x100: red | green | blue thirds. Cover into square shows the green middle
// and crops red+blue — the overflow a smear must NOT reach.
function rgbThirds(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 300; c.height = 100;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ff0000"; x.fillRect(0, 0, 100, 100);
  x.fillStyle = "#00ff00"; x.fillRect(100, 0, 100, 100);
  x.fillStyle = "#0000ff"; x.fillRect(200, 0, 100, 100);
  return c;
}

describe("smear confined to the visible crop window", () => {
  const src = { kind: 'text', canvas: rgbThirds() } as const;

  it("horizontal cover smear stays green — no red/blue overflow bleed", () => {
    let out = new Uint8Array(W * H * 4);
    withRenderer((r, canvas) => {
      r.beginFrame();
      r.drawTile(makeTile({ source: src, fit: 'cover', smear: 40, smearAngle: 0, smearJitter: 0 }));
      r.endFrame();
      const gl = canvas.getContext('webgl2')!;
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    });
    const px = (x: number) => { const i = ((H - 1 - 50) * W + x) * 4; return [out[i], out[i + 1], out[i + 2]]; };
    for (const x of [2, 50, 97]) {
      const [rr, gg, bb] = px(x);
      expect(gg).toBeGreaterThan(200);   // still green
      expect(rr).toBeLessThan(40);       // no red overflow (was ~80 at left edge)
      expect(bb).toBeLessThan(40);       // no blue overflow (was ~80 at right edge)
    }
  });

  it("direct cover smear == render() cover smear (bake is transparent)", () => {
    const meanDiff = (jit: number) => {
      const d = new Uint8Array(W * H * 4), rn = new Uint8Array(W * H * 4);
      withRenderer((r, canvas) => {
        const gl = canvas.getContext('webgl2')!;
        r.beginFrame();
        r.drawTile(makeTile({ source: src, fit: 'cover', smear: 40, smearAngle: 0, smearJitter: jit }));
        r.endFrame();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, d);
        // manual .render(): bake the cover source geometry-neutralised into an FBO,
        // then draw the FBO fill + smear (what renderBakeChain does).
        r.beginFrame();
        r.beginOffscreen("b", false, W, H); r.clearTarget!();
        r.drawTile(makeTile({ source: src, fit: 'cover', x: 0.5, y: 0.5, w: 1, h: 1 }));
        r.endFrame(); r.endOffscreen();
        r.drawTile(makeTile({ source: { kind: 'pattern', name: 'b' } as any, fit: 'fill', smear: 40, smearAngle: 0, smearJitter: jit }));
        r.endFrame();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rn);
      });
      let sum = 0;
      for (let i = 0; i < d.length; i += 4)
        sum += Math.abs(d[i] - rn[i]) + Math.abs(d[i + 1] - rn[i + 1]) + Math.abs(d[i + 2] - rn[i + 2]);
      return sum / (W * H);
    };
    expect(meanDiff(0)).toBeLessThan(0.5);   // jitter-free: essentially identical
    expect(meanDiff(0.5)).toBeLessThan(4);   // with jitter: tiny residual (edge resample)
  });
});
