/**
 * OP_MODULATE pixel semantics + batching edge cases.
 *
 * The modulator is always an FBO texture (the auto-FBO path renders every
 * modulator through an offscreen pass), so these tests populate a named FBO
 * via beginOffscreen and then draw consumer tiles with modSrc pointing at it.
 *
 * Displacement maths (centred, alpha-weighted, hardcoded 0.5 bias):
 *   uv += (mod.rg - 0.5) * amt * mod.a
 *   opaque white  → +amt/2 (samples visually down/right)
 *   opaque black  → -amt/2
 *   opaque mid-grey / transparent → no displacement
 *
 * Orientation ground truth pinned here: FBO texels are y-up (visual top at
 * V=1), element-source working UVs are y-down. The uv-space lookup mirrors
 * y-down consumer UVs into FBO texel space and flips the displacement sign for
 * FBO-source consumers, so a fullscreen uncropped tile behaves identically in
 * all three modspaces and green > 0.5 always samples visually downward.
 */
import { describe, it, expect } from "vitest";
import { makeTile, withRenderer, readPixel, W, H } from "./webgl-test-helpers";
import { MAX_TEX_UNITS, type WebGLRenderer } from "./webgl-renderer";
import type { TileParams } from "./renderer-interface";
import { flushWarnings, clearWarnings } from "./warnings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 100×100 canvas split into two colours at `at` (0..1), along x or y. */
function splitCanvas(a: string, b: string, axis: 'x' | 'y', at = 0.5): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = b;
  if (axis === 'x') ctx.fillRect(at * 100, 0, 100 - at * 100, 100);
  else ctx.fillRect(0, at * 100, 100, 100 - at * 100);
  return c;
}

/** Left-red / right-blue source, split at `at`. */
function redBlueX(at = 0.5): TileParams['source'] {
  return { kind: 'text', canvas: splitCanvas('#f00', '#00f', 'x', at) };
}

/** Top-red / bottom-blue source. */
function redBlueY(): TileParams['source'] {
  return { kind: 'text', canvas: splitCanvas('#f00', '#00f', 'y') };
}

/** Render solid-colour tiles into FBO `name` (cleared first). */
function fillFBO(renderer: WebGLRenderer, name: string, tiles: TileParams[]): void {
  renderer.beginOffscreen(name);
  renderer.beginFrame();
  for (const t of tiles) renderer.drawTile(t);
  renderer.endFrame();
  renderer.endOffscreen();
}

const WHITE: TileParams['source'] = { kind: 'color', r: 1, g: 1, b: 1 };
const BLACK: TileParams['source'] = { kind: 'color', r: 0, g: 0, b: 0 };
const GREY:  TileParams['source'] = { kind: 'color', r: 0.5, g: 0.5, b: 0.5 };

function expectRed([r, , b]: number[], msg?: string): void {
  expect(r, msg).toBeGreaterThan(150);
  expect(b, msg).toBeLessThan(100);
}
function expectBlue([r, , b]: number[], msg?: string): void {
  expect(b, msg).toBeGreaterThan(150);
  expect(r, msg).toBeLessThan(100);
}

// ---------------------------------------------------------------------------
// Core displacement semantics
// ---------------------------------------------------------------------------

describe("modulate displacement", () => {
  it("opaque mid-grey modulator = no displacement", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [makeTile({ source: GREY })]);
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 1 }));
      renderer.endFrame();
      expectRed(readPixel(canvas, 25, 50));
      expectBlue(readPixel(canvas, 75, 50));
    });
  });

  it("opaque white modulator shifts sampling by +amt/2", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [makeTile({ source: WHITE })]);
      // uv.x at screen x=40 is 0.40; +0.25 → 0.65 → right half (blue).
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 0.5 }));
      renderer.endFrame();
      expectBlue(readPixel(canvas, 40, 50));
    });
  });

  it("opaque black modulator shifts sampling by -amt/2", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [makeTile({ source: BLACK })]);
      // uv.x at screen x=60 is 0.60; -0.25 → 0.35 → left half (red).
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 0.5 }));
      renderer.endFrame();
      expectRed(readPixel(canvas, 60, 50));
    });
  });

  it("empty (transparent) modulator FBO displaces nothing — alpha weighting", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", []); // cleared to transparent black
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 1 }));
      renderer.endFrame();
      expectRed(readPixel(canvas, 25, 50));
      expectBlue(readPixel(canvas, 75, 50));
    });
  });

  it("missing modulator FBO warns and draws unmodulated (internal-bug path)", () => {
    clearWarnings();
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "nope", modAmt: 1 }));
      renderer.endFrame();
      expectRed(readPixel(canvas, 25, 50));
      expectBlue(readPixel(canvas, 75, 50));
    });
    expect(flushWarnings().some(m => m.includes('nope'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orientation + modspace coincidence on a fullscreen uncropped tile
// ---------------------------------------------------------------------------

// Modulator: top half opaque white, bottom half opaque mid-grey.
// Consumer: top-red / bottom-blue, fullscreen fill.
// Correct orientation: a fragment near the top reads WHITE (not grey) →
// samples +0.25 visually downward → blue appears in the top half.
// A y-flipped lookup would read grey → no displacement → red (fails).
function orientationFBO(renderer: WebGLRenderer): void {
  fillFBO(renderer, "m", [
    makeTile({ source: WHITE, y: 0.25, h: 0.5 }), // visual top half
    makeTile({ source: GREY,  y: 0.75, h: 0.5 }), // visual bottom half
  ]);
}

describe("modspace orientation (fullscreen tile: all three spaces coincide)", () => {
  for (const space of ['screen', 'tile', 'uv'] as const) {
    it(`'${space}': top fragment reads modulator's visual top`, () => {
      withRenderer((renderer, canvas) => {
        renderer.beginFrame();
        orientationFBO(renderer);
        renderer.drawTile(makeTile({
          source: redBlueY(), modSrc: "m", modAmt: 0.5, modSpace: space,
        }));
        renderer.endFrame();
        // Top area (y=30): white → uv.y 0.3+0.25 = 0.55 → blue.
        expectBlue(readPixel(canvas, 50, 30), `space=${space} top`);
        // Bottom area (y=80): grey → no move → stays blue.
        expectBlue(readPixel(canvas, 50, 80), `space=${space} bottom`);
        // Near-top control (y=10): 0.1+0.25 = 0.35 → still red.
        expectRed(readPixel(canvas, 50, 10), `space=${space} control`);
      });
    });
  }

  it("'uv' on an FBO-source consumer displaces visually the same way", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      orientationFBO(renderer);
      // Consumer content lives in FBO "src" (top red / bottom blue), consumed
      // as a pattern source — its working UVs are y-up, unlike element sources.
      fillFBO(renderer, "src", [
        makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, y: 0.25, h: 0.5 }),
        makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 }, y: 0.75, h: 0.5 }),
      ]);
      renderer.drawTile(makeTile({
        source: { kind: 'pattern', name: 'src' },
        modSrc: "m", modAmt: 0.5, modSpace: 'uv',
      }));
      renderer.endFrame();
      // Identical expectations to the element-consumer case above.
      expectBlue(readPixel(canvas, 50, 30), 'fbo-consumer top');
      expectBlue(readPixel(canvas, 50, 80), 'fbo-consumer bottom');
      expectRed(readPixel(canvas, 50, 10), 'fbo-consumer control');
    });
  });
});

// ---------------------------------------------------------------------------
// tile vs screen space on a NON-fullscreen tile
// ---------------------------------------------------------------------------

describe("modspace tile vs screen (half-width tile)", () => {
  // Modulator: left half opaque black, right half opaque white.
  // Consumer: red|blue split source in the LEFT half of the canvas (w=0.5).
  // Probe at screen x=30 → tile-local 0.6:
  //   screen: reads modulator at x=0.3 → black → -0.25 → uv 0.35 → red
  //   tile:   reads modulator at 0.6   → white → +0.25 → uv 0.85 → blue
  function setup(renderer: WebGLRenderer, space: 'screen' | 'tile'): void {
    renderer.beginFrame();
    fillFBO(renderer, "m", [
      makeTile({ source: BLACK, x: 0.25, w: 0.5 }),
      makeTile({ source: WHITE, x: 0.75, w: 0.5 }),
    ]);
    renderer.drawTile(makeTile({
      source: redBlueX(), x: 0.25, w: 0.5, fit: 'fill',
      modSrc: "m", modAmt: 0.5, modSpace: space,
    }));
    renderer.endFrame();
  }

  it("'screen' reads the region under the tile", () => {
    withRenderer((renderer, canvas) => {
      setup(renderer, 'screen');
      expectRed(readPixel(canvas, 30, 50));
    });
  });

  it("'tile' squeezes the whole modulator into the tile", () => {
    withRenderer((renderer, canvas) => {
      setup(renderer, 'tile');
      expectBlue(readPixel(canvas, 30, 50));
    });
  });
});

// ---------------------------------------------------------------------------
// 'uv' space: works through prior UV warps (slot after BARREL) + fract wrap
// ---------------------------------------------------------------------------

describe("modspace 'uv' working-UV semantics", () => {
  it("sees the barrel-warped UV (slot between BARREL and PIXELATE)", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Modulator: black left of 0.8, white right of it.
      fillFBO(renderer, "m", [
        makeTile({ source: BLACK, x: 0.4, w: 0.8 }),
        makeTile({ source: WHITE, x: 0.9, w: 0.2 }),
      ]);
      // barrel=5 pulls uv 0.9 → 0.72 (d=0.4, r²=0.16, scale=1+5·(0.16−0.25)=0.55).
      // 'uv' lookup at the warped 0.72 → BLACK (< 0.8) → −0.25 → 0.47 → red.
      // If MODULATE ran before BARREL it would read 0.9 → white → +0.25 → uv
      // 1.15 → barrel pushes it far out of [0,1] → clipped (transparent).
      renderer.drawTile(makeTile({
        source: redBlueX(), barrel: 5,
        modSrc: "m", modAmt: 0.5, modSpace: 'uv',
      }));
      renderer.endFrame();
      const px = readPixel(canvas, 90, 50);
      expect(px[3]).toBe(255); // not clipped
      expectRed(px);
    });
  });

  it("'uv' is cell-local — a crop scroll is applied downstream, not seen by the modulator", () => {
    // In the cell-local model, UV effects (modulate included) run in the cell's
    // [0,1] frame; the crop window (incl. scroll) maps that frame onto the source
    // afterwards, at OP_WRAP. So the modulator lookup is UNAFFECTED by cropx.
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Modulator: black left half, white right half.
      fillFBO(renderer, "m", [
        makeTile({ source: BLACK, x: 0.25, w: 0.5 }),
        makeTile({ source: WHITE, x: 0.75, w: 0.5 }),
      ]);
      // Screen x=70 → local.x 0.7 → modulator WHITE → disp +0.15 → local 0.85.
      // OP_WRAP then applies cropx=1 (uvOffset 0.5) → 0.5+0.85 = 1.35 → fract 0.35
      // → source (split at 0.2) BLUE. The OLD source-space model read the scrolled
      // uv 1.2 at modulate time → BLACK → −0.15 → red; the crop scroll no longer
      // leaks into the modulator lookup.
      renderer.drawTile(makeTile({
        source: redBlueX(0.2), cropx: 1,
        modSrc: "m", modAmt: 0.3, modSpace: 'uv',
      }));
      renderer.endFrame();
      expectBlue(readPixel(canvas, 70, 50));
    });
  });
});

// ---------------------------------------------------------------------------
// Batching: dual-unit accounting + UBO-overflow retry
// ---------------------------------------------------------------------------

describe("modulate batching", () => {
  it("counts BOTH textures at the unit boundary (batch break, not unit overflow)", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [makeTile({ source: WHITE })]);
      // Fill units 0..13 with distinct colour textures. Unit 0 is opaque
      // mid-grey: if the accounting under-counts, the modulator lands past the
      // sampler chain and sampleAny falls back to u_tex[0] → grey → NO
      // displacement, which the assertion below catches.
      for (let i = 0; i < MAX_TEX_UNITS - 1; i++) {
        const v = i === 0 ? 0.5 : 0.02 * i;
        renderer.drawTile(makeTile({ source: { kind: 'color', r: 0.5, g: v, b: 0.5 } }));
      }
      // 15th unique source texture + modulator = 16 units needed → must break.
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 0.5 }));
      renderer.endFrame();
      // White modulator: uv 0.4 + 0.25 → 0.65 → blue.
      expectBlue(readPixel(canvas, 40, 50));
    });
  });

  it("UBO-overflow retry seeds the fresh batch with both textures", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [makeTile({ source: WHITE })]);
      // 170 unique 3-op chains (distinct alpha defeats dedup) fill 1020 of the
      // 1024 UBO vec4 slots; the modulated tile's 4-op chain (8 vec4s) cannot
      // fit → overflow → flush + retry, which must re-seed BOTH textures. A
      // stale modulator index would sample an unbound unit (opaque black) and
      // displace the wrong way.
      for (let i = 0; i < 170; i++) {
        renderer.drawTile(makeTile({
          source: { kind: 'color', r: 0.5, g: 0.5, b: 0.5 },
          alpha: 0.3 + i * 0.002,
        }));
      }
      renderer.drawTile(makeTile({ source: redBlueX(), modSrc: "m", modAmt: 0.5 }));
      renderer.endFrame();
      // White modulator: uv 0.4 + 0.25 → 0.65 → blue (black would give red).
      expectBlue(readPixel(canvas, 40, 50));
    });
  });
});
