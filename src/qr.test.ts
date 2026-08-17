import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import "./visual-controls"; // side-effect: registers .width()/.x()/… on Pattern.prototype
import { qr } from "./qr-pattern";
import { renderQrToCanvas } from "./qr-render";
import { makeTile, renderTiles, readPixel } from "./webgl-test-helpers";

/** Decode a white-on-transparent QR canvas. Transparent → black in luminance, so
 *  the modules read as an inverted code; `attemptBoth` handles the inversion. */
function decode(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return res ? res.data : null;
}

describe("qr() source", () => {
  it("produces a qr source value carrying the payload", () => {
    const events = qr("https://picodevil.com").queryArc(0, 1);
    expect(events).toHaveLength(1);
    expect(events[0].value).toEqual({ _type: "qr", data: "https://picodevil.com" });
  });

  it("treats the whole string as one literal (not mininotation)", () => {
    // A URL with slashes must not be split — pure(), not mini().
    const events = qr("https://x.com/a/b").queryArc(0, 1);
    expect(events).toHaveLength(1);
    expect(events[0].value.data).toBe("https://x.com/a/b");
  });

  it("chains universal controls without losing the payload", () => {
    const events = qr("https://picodevil.com").width(0.3).x(0.35).queryArc(0, 1);
    expect(events[0].value._type).toBe("qr");
    expect(events[0].value.data).toBe("https://picodevil.com");
    expect(Number(events[0].value.width)).toBeCloseTo(0.3);
  });
});

describe("renderQrToCanvas", () => {
  it("round-trips a URL through render → decode", () => {
    const url = "https://picodevil.com";
    const canvas = renderQrToCanvas(url);
    expect(canvas.width).toBe(canvas.height);
    expect(canvas.width).toBeGreaterThan(64);
    expect(decode(canvas)).toBe(url);
  });

  it("renders white modules on a transparent background", () => {
    const canvas = renderQrToCanvas("https://picodevil.com");
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Top-left corner sits in the quiet zone → fully transparent.
    expect(data[3]).toBe(0);

    // Every pixel is either a pure-white opaque module or fully transparent —
    // never an opaque backing colour. Scan once, assert once.
    let foundWhite = false;
    let foundOpaqueBacking = false;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 255 && r === 255 && g === 255 && b === 255) foundWhite = true;
      else if (a === 255 && (r !== 255 || g !== 255 || b !== 255)) foundOpaqueBacking = true;
    }
    expect(foundWhite).toBe(true);
    expect(foundOpaqueBacking).toBe(false);
  });


  it("round-trips a longer payload (auto-sizes the version)", () => {
    const url = "https://picodevil.com/#v1,some/longer/path?with=query&and=more";
    expect(decode(renderQrToCanvas(url))).toBe(url);
  });
});

describe("qr tile through the WebGL backend", () => {
  it("draws white modules on transparent through the full pipeline", () => {
    // A kind:'qr' TileSource → texture-cache canvas upload → shader → pixels.
    const canvas = renderQrToCanvas("https://picodevil.com");
    const out = renderTiles([makeTile({ source: { kind: "qr", canvas }, fit: "fill" })]);

    let maxLum = 0;
    let minAlpha = 255;
    for (let y = 0; y < 100; y += 3) {
      for (let x = 0; x < 100; x += 3) {
        const [r, g, b, a] = readPixel(out, x, y);
        maxLum = Math.max(maxLum, (r + g + b) / 3);
        minAlpha = Math.min(minAlpha, a);
      }
    }
    expect(maxLum).toBeGreaterThan(200); // at least one bright white module drew
    expect(minAlpha).toBe(0);            // at least one fully-transparent gap survived
  });

  it("samples the QR texture with NEAREST — no bilinear edge fringe", () => {
    // A hard opaque/transparent boundary, magnified. NEAREST keeps output alpha
    // binary (a crisp edge); LINEAR would blend the white edge toward the
    // (0,0,0,0) background, producing intermediate alphas — the dark fringe.
    const src = document.createElement("canvas");
    src.width = 2;
    src.height = 1;
    const sctx = src.getContext("2d")!;
    sctx.clearRect(0, 0, 2, 1);
    sctx.fillStyle = "white";
    sctx.fillRect(0, 0, 1, 1); // left texel opaque white, right texel transparent

    const out = renderTiles([makeTile({ source: { kind: "qr", canvas: src }, fit: "fill" })]);

    let fractional = 0;
    for (let y = 0; y < 100; y += 7) {
      for (let x = 0; x < 100; x++) {
        const a = readPixel(out, x, y)[3];
        if (a !== 0 && a !== 255) fractional++;
      }
    }
    expect(fractional).toBe(0);

    // Decisiveness check: an identical source through the LINEAR path (kind:'text')
    // DOES fringe — intermediate alphas at the boundary — proving the NEAREST
    // override on kind:'qr' is what removes it, not the test being vacuous. Must be
    // a *separate* canvas: textures are cached by canvas identity, so reusing `src`
    // would hand back the NEAREST texture created above.
    const src2 = document.createElement("canvas");
    src2.width = 2;
    src2.height = 1;
    const s2 = src2.getContext("2d")!;
    s2.clearRect(0, 0, 2, 1);
    s2.fillStyle = "white";
    s2.fillRect(0, 0, 1, 1);
    const linearOut = renderTiles([makeTile({ source: { kind: "text", canvas: src2 }, fit: "fill" })]);
    let linearFractional = 0;
    for (let x = 0; x < 100; x++) {
      const a = readPixel(linearOut, x, 50)[3];
      if (a !== 0 && a !== 255) linearFractional++;
    }
    expect(linearFractional).toBeGreaterThan(0);
  });
});
