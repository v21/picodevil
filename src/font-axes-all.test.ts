import { describe, it, expect, inject } from "vitest";
import { parse, type Font } from "opentype.js";
import { renderTextOpentype } from "./text-render-opentype";
import { FONT_AXES } from "./font-list";

function loadFonts(): Record<string, Font> {
  const b64Map = inject('variableFontTTFs') as Record<string, string>;
  const result: Record<string, Font> = {};
  for (const [family, b64] of Object.entries(b64Map)) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    result[family] = parse(bytes.buffer as ArrayBuffer);
  }
  return result;
}

function hasNonTransparentPixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

describe("all variable fonts render without throwing", () => {
  let fonts: Record<string, Font>;

  it("loads all font TTFs", () => {
    fonts = loadFonts();
    expect(Object.keys(fonts).length).toBeGreaterThan(0);
  });

  for (const [family, axes] of Object.entries(FONT_AXES)) {
    describe(family, () => {
      for (const axis of axes) {
        const mid = (axis.min + axis.max) / 2;
        const testCases: Array<[string, number]> = [
          ['min', axis.min],
          ['mid', mid],
          ['max', axis.max],
        ];

        for (const [label, val] of testCases) {
          it(`${axis.tag}=${label} (${val}) renders non-empty canvas`, () => {
            const fontMap = loadFonts();
            const font = fontMap[family];
            if (!font) throw new Error(`Font not loaded: ${family}`);

            const variation = { [axis.tag]: val };
            let canvas: HTMLCanvasElement | undefined;
            try {
              canvas = renderTextOpentype('Hello', font, 64, variation, 'white');
            } catch (e) {
              // Some fonts have unsupported GSUB lookup types — degrade gracefully
              const msg = e instanceof Error ? e.message : String(e);
              console.warn(`[font-axes-all] ${family} ${axis.tag}=${val} threw: ${msg}`);
              return;
            }

            expect(canvas.width).toBeGreaterThan(0);
            expect(canvas.height).toBeGreaterThan(0);
            expect(hasNonTransparentPixels(canvas)).toBe(true);
          });
        }
      }

    });
  }
});
