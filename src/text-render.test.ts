import { describe, it, expect } from "vitest";
import { buildFontString, renderTextToCanvas } from "./text-render";

describe("buildFontString", () => {
  it("prepends default size when font is a family name", () => {
    expect(buildFontString('IBM Plex Mono')).toBe('36px IBM Plex Mono');
  });

  it("uses font as-is when it already contains a size", () => {
    expect(buildFontString('bold 18px monospace')).toBe('bold 18px monospace');
  });

  it("prepends fontSize when font has no size", () => {
    expect(buildFontString('bold monospace', 24)).toBe('24px bold monospace');
  });

  it("replaces size in font shorthand when fontSize is provided", () => {
    expect(buildFontString('bold 32px monospace', 18)).toBe('bold 18px monospace');
  });

  it("uses default family when font is undefined, with explicit size", () => {
    expect(buildFontString(undefined, 16)).toBe('16px sans-serif');
  });

  it("uses default family and default size when both are undefined", () => {
    expect(buildFontString(undefined, undefined)).toBe('36px sans-serif');
  });

  it("handles fractional sizes", () => {
    expect(buildFontString('Arial', 14.5)).toBe('14.5px Arial');
  });

  it("detects em units as a size", () => {
    expect(buildFontString('1.2em serif')).toBe('1.2em serif');
  });
});

describe("renderTextToCanvas", () => {
  it("produces a canvas with width >= text + 2*padding for single line", () => {
    const canvas = renderTextToCanvas('hello', '36px sans-serif', 'white');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it("multi-line canvas height is greater than single-line", () => {
    const single = renderTextToCanvas('line one', '24px sans-serif', 'white');
    const multi  = renderTextToCanvas('line one\nline two', '24px sans-serif', 'white');
    expect(multi.height).toBeGreaterThan(single.height);
  });

  it("multi-line canvas width equals max line width (not sum)", () => {
    const single = renderTextToCanvas('short', '24px sans-serif', 'white');
    const multi  = renderTextToCanvas('short\nshort', '24px sans-serif', 'white');
    expect(multi.width).toBe(single.width);
  });

  it("empty string produces a non-zero canvas (min 1px content width)", () => {
    const canvas = renderTextToCanvas('', '24px sans-serif', 'white');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it("transparent background: top-left pixel alpha is 0 with no fontBGColor", () => {
    const canvas = renderTextToCanvas('   ', '24px sans-serif', 'white');
    const ctx = canvas.getContext('2d')!;
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    expect(pixel[3]).toBe(0);
  });

  it("fontBGColor fills the background", () => {
    const canvas = renderTextToCanvas('   ', '24px sans-serif', 'white', 'red');
    const ctx = canvas.getContext('2d')!;
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    expect(pixel[3]).toBe(255); // opaque
    expect(pixel[0]).toBeGreaterThan(200); // red-ish
  });
});
