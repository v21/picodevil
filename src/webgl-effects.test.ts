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
import { makeTile, renderTile, renderTiles, withRenderer, readPixel, W, H } from "./webgl-test-helpers";
import { flushWarnings, clearWarnings } from "./warnings";

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

  it("subtract: white − white = black", () => {
    // FUNC_SUBTRACT with ONE,ONE: dst - src = (1,1,1) - (1,1,1) = (0,0,0)
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, blend: 'subtract' }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeLessThan(20);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(20);
  });

  it("subtract: red − blue = red (blue channel clamps to 0)", () => {
    // dst=(1,0,0) src=(0,0,1) alpha=1: dst - src*alpha = (1,0,-1) clamped = (1,0,0)
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 }, blend: 'subtract' }),
    ]);
    const [r, , b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(20);
  });

  it("subtract: alpha scales subtraction amount", () => {
    // dst=white (1,1,1), src=white alpha=0.5: dst - src*0.5 = (0.5,0.5,0.5) ≈ 128
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, blend: 'subtract', alpha: 0.5 }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(96);
    expect(r).toBeLessThan(160);
    expect(Math.abs(r - g)).toBeLessThan(10);
    expect(Math.abs(g - b)).toBeLessThan(10);
  });

  it("min: min(white, grey) = grey", () => {
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 1, g: 1, b: 1 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0.5, g: 0.5, b: 0.5 }, blend: 'min' }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    // min(255, 128) = 128 ± tolerance
    expect(r).toBeLessThan(160);
    expect(r).toBeGreaterThan(96);
    expect(Math.abs(r - g)).toBeLessThan(10);
    expect(Math.abs(g - b)).toBeLessThan(10);
  });

  it("max: max(black, grey) = grey", () => {
    const canvas = renderTiles([
      makeTile({ source: { kind: 'color', r: 0, g: 0, b: 0 }, blend: 'source-over' }),
      makeTile({ source: { kind: 'color', r: 0.5, g: 0.5, b: 0.5 }, blend: 'max' }),
    ]);
    const [r, g, b] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(96);
    expect(r).toBeLessThan(160);
    expect(Math.abs(r - g)).toBeLessThan(10);
    expect(Math.abs(g - b)).toBeLessThan(10);
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

// ---------------------------------------------------------------------------
// Barrel distortion
// ---------------------------------------------------------------------------

describe("barrel", () => {
  it("barrel=0 is identity — center pixel unchanged", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      barrel: 0,
    }));
    const [r, , , a] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(a).toBe(255);
  });

  it("barrel=10 — center pixel is still opaque red", () => {
    // Center UV d=(0,0): dx²·dy²=0, so scale=1 — center is always unchanged.
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      barrel: 10,
    }));
    const [r, , , a] = readPixel(canvas, 50, 50);
    expect(r).toBeGreaterThan(200);
    expect(a).toBe(255);
  });

  it("barrel=10 — corners are transparent (UV out of [0,1])", () => {
    // With fit='fill', source UV spans exactly [0,1]. Barrel pushes corners
    // beyond 1, triggering the alpha=0 discard.
    // At corner d=(0.5,0.5): scale = 1 + 10*0.0625 = 1.625 → raw = 1.3125 → outside.
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      fit: 'fill',
      barrel: 10,
    }));
    // Top-left corner
    const [, , , a] = readPixel(canvas, 1, 1);
    expect(a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Barrel in cell-local space: UV effects operate in the drawn cell's [0,1]
// frame, and the crop window maps that frame onto the source at sample time.
// So barrel is centred on and scaled to the visible cell, regardless of where
// (or how big) the crop window is — not centred on the source's 0.5.
// ---------------------------------------------------------------------------

describe("barrel in cell-local space (crop)", () => {
  it("off-centre crop: barrel is symmetric about the cell centre", () => {
    // Crop window = right half of the source (cropx .75, cropw .5). In the old
    // source-space model the barrel centred on source-UV 0.5 (the cell's LEFT
    // edge), so the left corner stayed opaque while the right blew out —
    // asymmetric. In cell-local space both corners push out alike.
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      cropx: 0.75, cropw: 0.5,
      fit: 'fill', barrel: 10,
    }));
    const [rC, , , aC] = readPixel(canvas, 50, 50);   // centre
    const [, , , aTL]  = readPixel(canvas, 3, 3);     // top-left corner
    const [, , , aTR]  = readPixel(canvas, W - 4, 3); // top-right corner
    expect(aC).toBe(255);              // centre opaque — barrel centred on the cell
    expect(rC).toBeGreaterThan(200);
    expect(Math.abs(aTL - aTR)).toBeLessThan(20);     // symmetric across the cell
  });

  it("scaled crop: barrel strength spans the cell, not the source", () => {
    // Quarter-size centred crop. In source space the barrel's r²−0.25 radial
    // term is measured over the crop's [0.25,0.75] range → too weak to reach
    // the corners (they stayed opaque). In cell-local space local spans [0,1],
    // so a corner blows out exactly like a full-frame barrel.
    const canvas = renderTile(makeTile({
      source: { kind: 'color', r: 1, g: 0, b: 0 },
      cropx: 0.5, cropy: 0.5, cropw: 0.5, croph: 0.5,
      fit: 'fill', barrel: 10,
    }));
    const [, , , aCentre] = readPixel(canvas, 50, 50);
    const [, , , aCorner] = readPixel(canvas, 3, 3);
    expect(aCentre).toBe(255);        // centre opaque
    expect(aCorner).toBe(0);          // corner pushed out, same as a full-frame barrel
  });
});

// ---------------------------------------------------------------------------
// Smear (5-tap directional Gaussian with per-sample positional jitter)
// ---------------------------------------------------------------------------

/** 100×100 canvas: left half white, right half black — a vertical hard edge at x=50. */
function edgeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 50, 100);
  ctx.fillStyle = "#000000"; ctx.fillRect(50, 0, 50, 100);
  return c;
}

describe("smear", () => {
  it("no smear: the hard edge stays sharp", () => {
    const canvas = renderTile(makeTile({ source: { kind: 'text', canvas: edgeCanvas() }, fit: 'fill' }));
    expect(readPixel(canvas, 35, 50)[0]).toBeGreaterThan(240); // white side
    expect(readPixel(canvas, 65, 50)[0]).toBeLessThan(15);     // black side
  });

  it("smear horizontal softens a vertical edge (white darkens, black lightens)", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'text', canvas: edgeCanvas() }, fit: 'fill',
      smear: 15, smearAngle: 0,
    }));
    expect(readPixel(canvas, 35, 50)[0]).toBeLessThan(240);    // was 255
    expect(readPixel(canvas, 65, 50)[0]).toBeGreaterThan(15);  // was 0
  });

  it("smear vertical (angle .25) leaves a vertical edge sharp — streak is perpendicular", () => {
    const canvas = renderTile(makeTile({
      source: { kind: 'text', canvas: edgeCanvas() }, fit: 'fill',
      smear: 15, smearAngle: 0.25,
    }));
    expect(readPixel(canvas, 35, 50)[0]).toBeGreaterThan(240);
    expect(readPixel(canvas, 65, 50)[0]).toBeLessThan(15);
  });

});

describe("snapshotSoFar / s('all') mid-frame compositing", () => {
  it("captures rendered content and exposes it as pattern:all", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Draw red
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      // Snapshot: flushes red draw, blits canvas → 'all' FBO
      renderer.snapshotSoFar();
      // Draw the snapshot over the existing red (source-over, same content)
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'all' } }));
      renderer.endFrame();

      const [r, g, b, a] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(10);
      expect(b).toBeLessThan(10);
      expect(a).toBe(255);
    });
  });

  it("second snapshot sees content drawn after first snapshot", () => {
    withRenderer((renderer, canvas) => {
      renderer.beginFrame();
      // Draw red, snapshot (all = red)
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.snapshotSoFar();
      // Draw blue on top of red, snapshot again (all = red+blue = magenta-ish via source-over)
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 0, g: 0, b: 1 } }));
      renderer.snapshotSoFar();
      // Now draw the second snapshot — should contain red+blue mixed
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'all' } }));
      renderer.endFrame();

      const [r, , b, a] = readPixel(canvas, 50, 50);
      // Blue was drawn on top of red (source-over), then snapshotted. The snapshot should be blue.
      // Drawing that over the canvas (which already has red+blue) keeps it blue-dominant.
      expect(b).toBeGreaterThan(200);
      expect(a).toBe(255);
      // red should be gone (covered by opaque blue)
      expect(r).toBeLessThan(10);
    });
  });
});

describe("FBO feedback-loop guard (input == output)", () => {
  it("warns and skips when a tile samples the FBO it is currently rendering into", () => {
    clearWarnings();
    withRenderer((renderer) => {
      renderer.beginFrame();
      // Bind the "quack" FBO as the render target, then try to draw the "quack"
      // FBO into itself — the self-reference that turns the screen black.
      renderer.beginOffscreen("quack");
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'quack' } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();
    });

    const msgs = flushWarnings();
    expect(msgs.some(m => m.includes("quack"))).toBe(true);
  });

  it("does not warn when sampling a different FBO than the render target", () => {
    clearWarnings();
    withRenderer((renderer) => {
      renderer.beginFrame();
      // Populate FBO "a" with red.
      renderer.beginOffscreen("a");
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      renderer.endOffscreen();
      // Render into FBO "b" while sampling FBO "a" — legal, no feedback loop.
      renderer.beginOffscreen("b");
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'a' } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();
    });

    expect(flushWarnings()).toEqual([]);
  });
});

describe("FBO double-buffering (self-reference feedback)", () => {
  it("self-reference reads the previous frame's content instead of blacking out", () => {
    withRenderer((renderer, canvas) => {
      // Frame 1: write opaque red into double-buffered FBO "x".
      renderer.beginFrame();
      renderer.beginOffscreen("x", true);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();

      // Frame 2: the ONLY tile drawn into "x" is the self-reference. If double-
      // buffering works it samples frame 1's red (previous frame); if it fell back
      // to the skip-guard the FBO would be transparent black.
      renderer.beginFrame();
      renderer.beginOffscreen("x", true);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'x' } }));
      renderer.endFrame();
      renderer.endOffscreen();
      // Draw the (post-swap) current "x" to the main canvas to inspect it.
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'x' } }));
      renderer.endFrame();

      const [r, g, b, a] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(10);
      expect(b).toBeLessThan(10);
      expect(a).toBe(255);
    });
  });

  it("does not warn when a double-buffered FBO references itself", () => {
    clearWarnings();
    withRenderer((renderer) => {
      renderer.beginFrame();
      renderer.beginOffscreen("x", true);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'x' } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();
    });

    expect(flushWarnings()).toEqual([]);
  });

  it("a double-buffered FBO stays a valid render target after a resize", () => {
    withRenderer((renderer, canvas) => {
      // Frame 1: allocate the double-buffered FBO (front + back) for "x".
      renderer.beginFrame();
      renderer.beginOffscreen("x", true);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.endFrame();

      // Resize must reallocate BOTH front and back textures (a GL error here, or
      // a stale back framebuffer, would surface as a broken render below).
      renderer.resize(W, H);

      // Frame 2: render fresh red into the (resized) back buffer, swap, display.
      renderer.beginFrame();
      renderer.beginOffscreen("x", true);
      renderer.beginFrame();
      renderer.drawTile(makeTile({ source: { kind: 'color', r: 1, g: 0, b: 0 } }));
      renderer.endFrame();
      renderer.endOffscreen();
      renderer.drawTile(makeTile({ source: { kind: 'pattern', name: 'x' } }));
      renderer.endFrame();

      const [r, , , a] = readPixel(canvas, 50, 50);
      expect(r).toBeGreaterThan(200);
      expect(a).toBe(255);
    });
  });
});

// ---------------------------------------------------------------------------
// Morphology: dilate() ring + smearop() reducers
//
// These need a source with spatial structure (max/min of a flat region is a
// no-op), so we render a centred bright square on black and probe points on the
// horizontal centre line (y=50) — robust to any V orientation. Jitter is set to 0
// for deterministic taps. The source is a 100×100 canvas at 'fill', so 1 source
// px ≈ 1 screen px and a radius in px maps 1:1 to the probe distances below.
// ---------------------------------------------------------------------------

/** 100×100 canvas: black background with a filled [x0,x1)×[y0,y1) rectangle in `color`. */
function squareCanvas(color: string, x0: number, y0: number, x1: number, y1: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 100; c.height = 100;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  return c;
}

describe("dilate() ring morphology", () => {
  it("dilate grows a bright square: a point 6px outside the left edge lights up", () => {
    const src = { kind: 'text' as const, canvas: squareCanvas("white", 40, 40, 60, 60) };
    // Baseline: without dilate, (34,50) is 6px left of the square → dark.
    const base = readPixel(renderTile(makeTile({ source: src })), 34, 50);
    expect(base[0]).toBeLessThan(60);
    // dilate radius 8 reaches its +X ring tap to (42,50), inside the white square.
    const dil = readPixel(renderTile(makeTile({ source: src, dilate: 8, dilateJitter: 0 })), 34, 50);
    expect(dil[0]).toBeGreaterThan(200);
  });

  it("erode (negative) shrinks a bright square: a point 3px inside the edge goes dark", () => {
    const src = { kind: 'text' as const, canvas: squareCanvas("white", 40, 40, 60, 60) };
    // (43,50) is 3px inside the left edge → white without erode.
    const base = readPixel(renderTile(makeTile({ source: src })), 43, 50);
    expect(base[0]).toBeGreaterThan(200);
    // erode radius 8 pulls the -X ring tap to (35,50), outside → min = black.
    const ero = readPixel(renderTile(makeTile({ source: src, dilate: -8, dilateJitter: 0 })), 43, 50);
    expect(ero[0]).toBeLessThan(60);
    // The core (10px from every edge > 8) survives erosion.
    const core = readPixel(renderTile(makeTile({ source: src, dilate: -8, dilateJitter: 0 })), 50, 50);
    expect(core[0]).toBeGreaterThan(200);
  });

  it("per-channel: dilating a red square grows red without inventing other channels", () => {
    const src = { kind: 'text' as const, canvas: squareCanvas("red", 40, 40, 60, 60) };
    const [r, g, b] = readPixel(renderTile(makeTile({ source: src, dilate: 8, dilateJitter: 0 })), 34, 50);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });
});

describe("smearop() reducers", () => {
  const whiteSquare = () => ({ kind: 'text' as const, canvas: squareCanvas("white", 40, 40, 60, 60) });

  it("smearop('max') is a directional dilate: grows the square along the smear axis", () => {
    // smear(0, 6) = horizontal taps spanning ±12px; smearMode 2 = per-channel max.
    const out = readPixel(renderTile(makeTile({
      source: whiteSquare(), smear: 6, smearAngle: 0, smearMode: 2, smearJitter: 0,
    })), 30, 50); // 10px left of the edge, within the +X tap reach
    expect(out[0]).toBeGreaterThan(200);
  });

  it("smearop('min') is a directional erode: eats the edge inward", () => {
    const out = readPixel(renderTile(makeTile({
      source: whiteSquare(), smear: 6, smearAngle: 0, smearMode: 3, smearJitter: 0,
    })), 44, 50); // 4px inside the left edge; a -X tap reaches outside → black
    expect(out[0]).toBeLessThan(60);
  });

  it("smearop('range') detects edges: flat interior dark, edge bright", () => {
    // A wide square (60px) so the centre is >12px (the ±2·6px smear span) from any
    // edge → a genuinely flat neighbourhood, unlike the 20px whiteSquare.
    const wide = { kind: 'text' as const, canvas: squareCanvas("white", 20, 20, 80, 80) };
    const interior = readPixel(renderTile(makeTile({
      source: wide, smear: 6, smearAngle: 0, smearMode: 8, smearJitter: 0,
    })), 50, 50);
    expect(interior[0]).toBeLessThan(60); // uniform white neighbourhood → max−min ≈ 0
    const edge = readPixel(renderTile(makeTile({
      source: wide, smear: 6, smearAngle: 0, smearMode: 8, smearJitter: 0,
    })), 20, 50);
    expect(edge[0]).toBeGreaterThan(180); // black|white straddle at the edge → range ≈ 1
  });

  it("smearop('avg') is unchanged plain smear (default reducer)", () => {
    const tile = { source: whiteSquare(), smear: 6, smearAngle: 0, smearJitter: 0 };
    const plain = readPixel(renderTile(makeTile({ ...tile })), 50, 50);
    const avg = readPixel(renderTile(makeTile({ ...tile, smearMode: 0 })), 50, 50);
    expect(avg).toEqual(plain);
  });

  it("jitter-only (pixels 0, jitter > 0) samples neighbours — a stochastic dither", () => {
    // No directional streak (smear 0) but a wide jitter: the 5 taps scatter around
    // the pixel, so the centre of a small bright square pulls in surrounding black.
    const sq = { source: whiteSquare(), smear: 0, smearAngle: 0, smearMode: 0 };
    const clean = readPixel(renderTile(makeTile({ ...sq, smearJitter: 0 })), 50, 50);
    expect(clean[0]).toBeGreaterThan(250); // no smear op at all → pure white centre
    const jit = readPixel(renderTile(makeTile({ ...sq, smearJitter: 40 })), 50, 50);
    expect(jit[0]).toBeLessThan(200);      // ±20px scatter reaches the black surround
  });

  it("smearop('rangel') is a coloured edge (abs(maxl−minl)), not greyscale", () => {
    // Red square on black: at the edge the brightest tap is red, the darkest black,
    // so abs(maxl−minl) = red — a coloured edge (R high, G/B low), unlike a grey range.
    const redSquare = { kind: 'text' as const, canvas: squareCanvas("red", 40, 40, 60, 60) };
    const [r, g, b] = readPixel(renderTile(makeTile({
      source: redSquare, smear: 6, smearAngle: 0, smearMode: 9, smearJitter: 0,
    })), 40, 50);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });
});
