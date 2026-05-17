/**
 * WebGL shader effects and blend mode tests.
 *
 * Contrast, brightness, grey, huerot: verified by exact or approximate pixel output.
 * Blend modes: source-over stacking, lighter (additive), multiply.
 * Alpha: partial coverage compositing.
 *
 * Math reference (all in sRGB space unless noted):
 *   contrast=0:    (rgb − 0.5) × 0 + 0.5               → 0.5  ≈ 128 for any input
 *   brightness=0.5 on black: (0 − 0.5) × 1 + 0.5 + 0.5 → 0.5  ≈ 128
 *   grey=1:        OKLab chroma zeroed (a=b=0)           → neutral grey (R=G=B)
 *   huerot=0.5:    OKLab chroma rotated 180°             → complement; red becomes teal/cyan
 *
 * Blend mode formulas (blendFuncSeparate, src.alpha=1 throughout):
 *   source-over:  src.rgb×α + dst.rgb×(1−α)   = standard Porter-Duff
 *   lighter/add:  src.rgb×α + dst.rgb          = additive (red+blue=magenta)
 *   multiply:     src.rgb×dst.rgb              = darken (0.5×0.5=0.25≈64)
 */
import { describe, it, expect } from "vitest";
import { makeTile, renderTile, renderTiles, readPixel } from "./webgl-test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 100×100 solid-color canvas for use as a 'text' source. */
function solidCanvas(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 100, 100);
  return c;
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

describe("contrast", () => {
  it("contrast=0 collapses any color to mid-grey (~128)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      contrast: 0,
    }));
    const [r, g, b, a] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThanOrEqual(125);
    expect(r).toBeLessThanOrEqual(131);
    expect(g).toBeGreaterThanOrEqual(125);
    expect(g).toBeLessThanOrEqual(131);
    expect(b).toBeGreaterThanOrEqual(125);
    expect(b).toBeLessThanOrEqual(131);
    expect(a).toBe(255);
  });

  it("contrast=2 amplifies: white stays white", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 1, b: 1 },
      contrast: 2,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  });

  it("contrast=2 amplifies: black stays black", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 0, g: 0, b: 0 },
      contrast: 2,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeLessThan(10);
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Brightness
// ---------------------------------------------------------------------------

describe("brightness", () => {
  it("brightness=0.5 on black → mid-grey (~128)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 0, g: 0, b: 0 },
      brightness: 0.5,
    }));
    const [r, g, b, a] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThanOrEqual(125);
    expect(r).toBeLessThanOrEqual(131);
    expect(g).toBeGreaterThanOrEqual(125);
    expect(b).toBeGreaterThanOrEqual(125);
    expect(a).toBe(255);
  });

  it("brightness=1 on black → white", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 0, g: 0, b: 0 },
      brightness: 1,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  });

  it("brightness=-1 on white → black", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 1, b: 1 },
      brightness: -1,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeLessThan(10);
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Grey (OKLab chroma desaturation)
// ---------------------------------------------------------------------------

describe("grey", () => {
  it("grey=0 (default) leaves red unchanged", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      grey: 0,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it("grey=1 desaturates any color: R=G=B", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      grey: 1,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(Math.abs(r - g)).toBeLessThan(3);
    expect(Math.abs(g - b)).toBeLessThan(3);
    expect(r).toBeGreaterThan(40); // non-trivial luminance (red is not black)
  });

  it("grey=1 on blue also produces neutral grey (R=G=B)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 0, g: 0, b: 1 },
      grey: 1,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(Math.abs(r - g)).toBeLessThan(3);
    expect(Math.abs(g - b)).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// Hue rotation (OKLab chroma rotation)
// ---------------------------------------------------------------------------

describe("huerot", () => {
  it("huerot=0 leaves red unchanged", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      huerot: 0,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it("huerot=0.5 (180°) shifts red toward its complement (teal/cyan)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      huerot: 0.5,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    // Red channel should drop significantly; green+blue should rise
    expect(r).toBeLessThan(100);
    expect(g + b).toBeGreaterThan(300);
  });

  it("huerot on neutral grey: grey has no OKLab chroma, rotation is a no-op", () => {
    // OKLab a=b=0 for grey → rotating (a,b) is a no-op → output stays grey (R=G=B)
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 0.5, g: 0.5, b: 0.5 },
      huerot: 0.5,
    }));
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(Math.abs(r - g)).toBeLessThan(5);
    expect(Math.abs(g - b)).toBeLessThan(5);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });
});

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

describe("blend modes", () => {
  it("source-over: second tile covers first", () => {
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 }, blend: 'source-over' }),
    ]);
    const [r, , b] = readPixel(canvas, 50, 50);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(20);
  });

  it("lighter (additive): red + blue = magenta", () => {
    // src.rgb×src.a + dst.rgb: (0,0,1)×1 + (1,0,0) = (1,0,1)
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 }, blend: 'lighter' }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(20);
    expect(b).toBeGreaterThan(200);
  });

  it("multiply: grey×grey = darker grey", () => {
    // src.rgb×dst.rgb: (0.5,0.5,0.5)×(0.5,0.5,0.5) = (0.25,0.25,0.25) ≈ 64
    const src = solidCanvas("#808080");
    const canvas = renderTiles([
      makeTile({ source: { kind: 'text', canvas: src }, blend: 'source-over' }),
      makeTile({ source: { kind: 'text', canvas: solidCanvas("#808080") }, blend: 'multiply' }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    // multiply darkens: result should be noticeably darker than 128
    expect(r).toBeLessThan(100);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);
    // and all channels equal (neutral grey stays grey under multiply)
    expect(Math.abs(r - g)).toBeLessThan(5);
    expect(Math.abs(g - b)).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// Alpha compositing
// ---------------------------------------------------------------------------

describe("alpha compositing", () => {
  it("alpha=1 is fully opaque", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      alpha: 1,
    }));
    const [, , , a] = readPixel(canvas, 50, 50);
    expect(a).toBe(255);
  });

  it("alpha=0 leaves canvas transparent (no contribution)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      alpha: 0,
    }));
    const [, , , a] = readPixel(canvas, 50, 50);
    expect(a).toBe(0);
  });

  it("alpha=0.5 over opaque red: blue blends to ~(128,0,128)", () => {
    // Red source-over first, then blue at half alpha.
    // source-over: src.rgb×src.a + dst.rgb×(1-src.a) = (0,0,1)×0.5 + (1,0,0)×0.5 = (0.5,0,0.5)
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 }, blend: 'source-over', alpha: 0.5 }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
    expect(g).toBeLessThan(20);
    expect(b).toBeGreaterThan(100);
    expect(b).toBeLessThan(160);
    expect(Math.abs(r - b)).toBeLessThan(15);
  });
});
