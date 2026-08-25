/**
 * OP_MATTE pixel semantics + batching edge cases.
 *
 * The matte source is always an FBO texture (the auto-FBO path renders every
 * matte through an offscreen pass), so these tests populate a named FBO via
 * beginOffscreen and then draw consumer tiles with matteSrc pointing at it.
 *
 * Alpha maths (luminance of the PREMULTIPLIED matte texel — so lum already
 * carries the matte's own alpha, and a transparent matte region masks out):
 *   a *= clamp(mix(1, k, |amt|), 0, 1),  k = amt >= 0 ? lum : 1 - lum
 *
 * The canvas blends source-over into a transparent-black clear, so the read-back
 * alpha channel IS the tile's final alpha — that's what these tests assert on.
 */
import { describe, it, expect } from "vitest";
import { makeTile, withRenderer, readPixel } from "./webgl-test-helpers";
import { MAX_TEX_UNITS, type WebGLRenderer } from "./webgl-renderer";
import type { TileParams } from "./renderer-interface";
import { flushWarnings, clearWarnings } from "./warnings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render tiles into FBO `name` (cleared first). */
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
const GREEN: TileParams['source'] = { kind: 'color', r: 0, g: 1, b: 0 };
const RED:   TileParams['source'] = { kind: 'color', r: 1, g: 0, b: 0 };

/** Draw one red tile matted by FBO "m" and return its centre alpha. */
function matteAlpha(overrides: Partial<TileParams>, fbo: TileParams[]): number {
  return withRenderer((renderer, canvas) => {
    renderer.beginFrame();
    fillFBO(renderer, "m", fbo);
    renderer.drawTile(makeTile({ source: RED, matteSrc: "m", ...overrides }));
    renderer.endFrame();
    return readPixel(canvas, 50, 50)[3];
  });
}

// ---------------------------------------------------------------------------
// Core luminance→alpha semantics
// ---------------------------------------------------------------------------

describe("matte luminance → alpha", () => {
  it("opaque white matte keeps the tile fully opaque", () => {
    expect(matteAlpha({}, [makeTile({ source: WHITE })])).toBe(255);
  });

  it("opaque black matte hides the tile completely", () => {
    expect(matteAlpha({}, [makeTile({ source: BLACK })])).toBe(0);
  });

  it("opaque mid-grey matte gives roughly half alpha", () => {
    expect(matteAlpha({}, [makeTile({ source: GREY })])).toBeGreaterThan(115);
    expect(matteAlpha({}, [makeTile({ source: GREY })])).toBeLessThan(140);
  });

  it("uses LUMINANCE, not a single channel — pure green ≈ 0.7152", () => {
    const a = matteAlpha({}, [makeTile({ source: GREEN })]);
    expect(a).toBeGreaterThan(170);
    expect(a).toBeLessThan(195);
  });

  it("an empty (transparent) matte FBO hides the tile — premultiplied lum", () => {
    expect(matteAlpha({}, [])).toBe(0);
  });

  it("a matte covering only half the canvas masks the tile to that shape", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Left half opaque white; right half never drawn → transparent.
      fillFBO(renderer, "m", [makeTile({ source: WHITE, x: 0.25, w: 0.5 })]);
      renderer.drawTile(makeTile({ source: RED, matteSrc: "m", matteSpace: 'screen' }));
      renderer.endFrame();
      expect(readPixel(canvas, 25, 50)[3]).toBe(255);
      expect(readPixel(canvas, 75, 50)[3]).toBe(0);
    });
  });

  it("composes with .alpha() — both multiply", () => {
    const a = matteAlpha({ alpha: 0.5 }, [makeTile({ source: WHITE })]);
    expect(a).toBeGreaterThan(115);
    expect(a).toBeLessThan(140);
  });
});

// ---------------------------------------------------------------------------
// amount
// ---------------------------------------------------------------------------

describe("matte amount", () => {
  it("amount 0 is a no-op even against a black matte", () => {
    expect(matteAlpha({ matteAmt: 0 }, [makeTile({ source: BLACK })])).toBe(255);
  });

  it("amount 0.5 against a black matte gives half alpha (partial strength)", () => {
    const a = matteAlpha({ matteAmt: 0.5 }, [makeTile({ source: BLACK })]);
    expect(a).toBeGreaterThan(115);
    expect(a).toBeLessThan(140);
  });

  it("negative amount inverts: black matte keeps, white matte hides", () => {
    expect(matteAlpha({ matteAmt: -1 }, [makeTile({ source: BLACK })])).toBe(255);
    expect(matteAlpha({ matteAmt: -1 }, [makeTile({ source: WHITE })])).toBe(0);
  });

  it("amount > 1 extrapolates into a harder key (mid-grey goes fully out)", () => {
    // Mid-grey round-trips as 128/255, so the extrapolation lands just above 0.
    expect(matteAlpha({ matteAmt: 2 }, [makeTile({ source: GREY })])).toBeLessThan(4);
    // ...while white still survives it (clamped at the top, not overshooting).
    expect(matteAlpha({ matteAmt: 2 }, [makeTile({ source: WHITE })])).toBe(255);
  });

  it("missing matte FBO warns and draws unmatted (internal-bug path)", () => {
    clearWarnings();
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: RED, matteSrc: "nope" }));
      renderer.endFrame();
      expect(readPixel(canvas, 50, 50)[3]).toBe(255);
    });
    expect(flushWarnings().some(m => m.includes('nope'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mattespace
// ---------------------------------------------------------------------------

describe("mattespace orientation (fullscreen tile: all three spaces coincide)", () => {
  for (const space of ['screen', 'tile', 'uv'] as const) {
    it(`'${space}': top fragment reads the matte's visual top`, () => {
      withRenderer((renderer, canvas) => {
        renderer.beginFrame();
        fillFBO(renderer, "m", [
          makeTile({ source: WHITE, y: 0.25, h: 0.5 }), // visual top half
          makeTile({ source: BLACK, y: 0.75, h: 0.5 }), // visual bottom half
        ]);
        renderer.drawTile(makeTile({ source: RED, matteSrc: "m", matteSpace: space }));
        renderer.endFrame();
        // A y-flipped lookup would swap these two.
        expect(readPixel(canvas, 50, 25)[3], `space=${space} top`).toBe(255);
        expect(readPixel(canvas, 50, 75)[3], `space=${space} bottom`).toBe(0);
      });
    });
  }
});

describe("mattespace orientation with an FBO-source consumer", () => {
  it("'uv' keys the same way whether the consumer is an element or an FBO", () => {
    // Element sources have y-down working UVs, FBO sources y-up — but the
    // crop/FBO map is deferred to OP_WRAP, so warpLocal (captured just before
    // it) is cell-local for BOTH and the mirror is unconditional. If that
    // assumption broke, this case would come out vertically flipped.
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [
        makeTile({ source: WHITE, y: 0.25, h: 0.5 }),
        makeTile({ source: BLACK, y: 0.75, h: 0.5 }),
      ]);
      fillFBO(renderer, "src", [makeTile({ source: RED })]);
      renderer.drawTile(makeTile({
        source: { kind: 'pattern', name: 'src' },
        matteSrc: "m", matteSpace: 'uv',
      }));
      renderer.endFrame();
      expect(readPixel(canvas, 50, 25)[3], 'fbo-consumer top').toBe(255);
      expect(readPixel(canvas, 50, 75)[3], 'fbo-consumer bottom').toBe(0);
    });
  });
});

describe("mattespace tile vs screen (half-width tile)", () => {
  // Matte: left half black, right half white.
  // Consumer: a tile filling the LEFT half of the canvas (w=0.5).
  // Probe at screen x=30 → tile-local 0.6:
  //   screen: reads the matte at 0.3 → black → hidden
  //   tile:   reads the matte at 0.6 → white → opaque
  function setup(renderer: WebGLRenderer, space: 'screen' | 'tile'): void {
    renderer.beginFrame();
    fillFBO(renderer, "m", [
      makeTile({ source: BLACK, x: 0.25, w: 0.5 }),
      makeTile({ source: WHITE, x: 0.75, w: 0.5 }),
    ]);
    renderer.drawTile(makeTile({
      source: RED, x: 0.25, w: 0.5, matteSrc: "m", matteSpace: space,
    }));
    renderer.endFrame();
  }

  it("'screen' reads the region under the tile", () => {
    withRenderer((renderer, canvas) => {
      setup(renderer, 'screen');
      expect(readPixel(canvas, 30, 50)[3]).toBe(0);
    });
  });

  it("'tile' squeezes the whole matte into the tile", () => {
    withRenderer((renderer, canvas) => {
      setup(renderer, 'tile');
      expect(readPixel(canvas, 30, 50)[3]).toBe(255);
    });
  });
});

describe("mattespace 'uv' working-UV semantics", () => {
  it("sees the barrel-warped UV, not the raw cell coord", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Matte: white left of 0.8, black right of it.
      fillFBO(renderer, "m", [
        makeTile({ source: WHITE, x: 0.4, w: 0.8 }),
        makeTile({ source: BLACK, x: 0.9, w: 0.2 }),
      ]);
      // barrel=5 pulls uv 0.9 → 0.72 (d=0.4, r²=0.16, scale=1+5·(0.16−0.25)=0.55).
      // 'uv' lookup at the warped 0.72 → WHITE → opaque.
      // Reading the raw local 0.9 instead would hit BLACK → hidden.
      renderer.drawTile(makeTile({
        source: RED, barrel: 5, matteSrc: "m", matteSpace: 'uv',
      }));
      renderer.endFrame();
      expect(readPixel(canvas, 90, 50)[3]).toBe(255);
    });
  });

  it("'uv' is cell-local — a crop scroll is applied downstream, not seen by the matte", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "m", [
        makeTile({ source: BLACK, x: 0.25, w: 0.5 }),
        makeTile({ source: WHITE, x: 0.75, w: 0.5 }),
      ]);
      // Screen x=70 → local.x 0.7 → matte WHITE → opaque, regardless of cropx.
      // A source-space lookup would read the scrolled uv 1.2 → fract 0.2 → BLACK.
      renderer.drawTile(makeTile({
        source: RED, cropx: 1, matteSrc: "m", matteSpace: 'uv',
      }));
      renderer.endFrame();
      expect(readPixel(canvas, 70, 50)[3]).toBe(255);
    });
  });
});

// ---------------------------------------------------------------------------
// Batching: a matted+modulated tile needs THREE texture units
// ---------------------------------------------------------------------------

describe("matte batching", () => {
  it("counts all THREE textures at the unit boundary (source + modulator + matte)", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "mod", [makeTile({ source: GREY })]);   // no displacement
      fillFBO(renderer, "m",   [makeTile({ source: BLACK })]);  // fully masks out
      // Fill units 0..12 with distinct colour textures. Unit 0 is opaque WHITE:
      // if the accounting under-counts, the matte texture lands past the sampler
      // chain and sampleAny falls back to u_tex[0] → white → NO masking, which
      // the assertion below catches.
      // Tucked into a corner: these are opaque, and a fullscreen filler would sit
      // UNDER the probe point and pin the read-back alpha at 255 regardless.
      for (let i = 0; i < MAX_TEX_UNITS - 2; i++) {
        const v = i === 0 ? 1 : 0.02 * i;
        renderer.drawTile(makeTile({
          source: { kind: 'color', r: v, g: v, b: v }, x: 0.02, y: 0.02, w: 0.02, h: 0.02,
        }));
      }
      // 14th unique source + modulator + matte = 16 units needed → must break.
      renderer.drawTile(makeTile({
        source: RED, modSrc: "mod", modAmt: 0.5, matteSrc: "m",
      }));
      renderer.endFrame();
      expect(readPixel(canvas, 50, 50)[3]).toBe(0);
    });
  });

  it("UBO-overflow retry seeds the fresh batch with all three textures", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      fillFBO(renderer, "mod", [makeTile({ source: GREY })]);
      fillFBO(renderer, "m",   [makeTile({ source: BLACK })]);
      // 170 unique 3-op chains (distinct alpha defeats dedup) fill 1020 of the
      // 1024 UBO vec4 slots; the 5-op chain below (10 vec4s) cannot fit →
      // overflow → flush + retry, which must re-seed ALL THREE textures. A stale
      // matte index would sample an unbound unit and fail to mask.
      for (let i = 0; i < 170; i++) {
        renderer.drawTile(makeTile({
          source: GREY, alpha: 0.3 + i * 0.002, x: 0.02, y: 0.02, w: 0.02, h: 0.02,
        }));
      }
      renderer.drawTile(makeTile({
        source: RED, modSrc: "mod", modAmt: 0.5, matteSrc: "m",
      }));
      renderer.endFrame();
      expect(readPixel(canvas, 50, 50)[3]).toBe(0);
    });
  });
});
