import { describe, it, expect, inject } from 'vitest';
import { makeFontEntryFromBuffer, renderTextHarfbuzz } from './text-render-harfbuzz';
import { FONT_AXES } from './font-list';

function loadEntry(family: string) {
  const b64Map = inject('variableFontTTFs') as Record<string, string>;
  const b64 = b64Map[family];
  if (!b64) throw new Error(`No TTF data for family: ${family}`);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return makeFontEntryFromBuffer(bytes.buffer as ArrayBuffer);
}

function hasNonTransparentPixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

function pixelDiff(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const ctx1 = a.getContext('2d')!;
  const ctx2 = b.getContext('2d')!;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const d1 = ctx1.getImageData(0, 0, w, h).data;
  const d2 = ctx2.getImageData(0, 0, w, h).data;
  let count = 0;
  for (let i = 0; i < d1.length; i++) if (d1[i] !== d2[i]) count++;
  return count;
}

describe('renderTextHarfbuzz', () => {
  it('renders Hepta Slab and produces non-empty canvas', () => {
    const entry = loadEntry('Hepta Slab');
    const canvas = renderTextHarfbuzz('Hello', entry, 64, {}, 'white');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(hasNonTransparentPixels(canvas)).toBe(true);
  });

  it('wght min vs max for Hepta Slab produces visually different renders', () => {
    const entry = loadEntry('Hepta Slab');
    const thin = renderTextHarfbuzz('WWWWWWWW', entry, 96, { wght: 1 }, 'white');
    const bold = renderTextHarfbuzz('WWWWWWWW', entry, 96, { wght: 900 }, 'white');
    expect(pixelDiff(thin, bold)).toBeGreaterThan(100);
  });

  it('renders Shantell Sans without throwing (previously threw on GSUB substFormat 2)', () => {
    const entry = loadEntry('Shantell Sans');
    const canvas = renderTextHarfbuzz('Hello', entry, 64, { wght: 300 }, 'white');
    expect(hasNonTransparentPixels(canvas)).toBe(true);
  });

  it('renders Source Serif 4 without throwing', () => {
    const entry = loadEntry('Source Serif 4');
    const canvas = renderTextHarfbuzz('Hello', entry, 64, { wght: 400 }, 'white');
    expect(hasNonTransparentPixels(canvas)).toBe(true);
  });

  it('renders Inter Tight without throwing (previously threw on GSUB substFormat 2)', () => {
    const entry = loadEntry('Inter Tight');
    const canvas = renderTextHarfbuzz('Hello world', entry, 64, { wght: 400 }, 'white');
    expect(hasNonTransparentPixels(canvas)).toBe(true);
  });

  it('Sono wght animates — min vs max produces different renders', () => {
    const entry = loadEntry('Sono');
    const light = renderTextHarfbuzz('glossing', entry, 96, { wght: 200 }, 'white');
    const heavy = renderTextHarfbuzz('glossing', entry, 96, { wght: 800 }, 'white');
    expect(pixelDiff(light, heavy)).toBeGreaterThan(100);
  });

  it('Anybody ital axis renders i l j differently from upright', () => {
    const entry = loadEntry('Anybody');
    const upright = renderTextHarfbuzz('ilj', entry, 96, { ital: 0 }, 'white');
    const italic  = renderTextHarfbuzz('ilj', entry, 96, { ital: 1 }, 'white');
    expect(pixelDiff(upright, italic)).toBeGreaterThan(100);
  });

  describe('all variable fonts render all axes at min/mid/max without throwing', () => {
    for (const [family, axes] of Object.entries(FONT_AXES)) {
      for (const axis of axes) {
        const mid = (axis.min + axis.max) / 2;
        for (const [label, val] of [['min', axis.min], ['mid', mid], ['max', axis.max]] as const) {
          it(`${family} ${axis.tag}=${label} (${val})`, () => {
            const entry = loadEntry(family);
            const canvas = renderTextHarfbuzz('Hello', entry, 64, { [axis.tag]: val }, 'white');
            // Only check canvas was created with valid dimensions — some axis extremes
            // legitimately render invisible glyphs (e.g. Handjet ELSH=0).
            expect(canvas.width).toBeGreaterThan(0);
            expect(canvas.height).toBeGreaterThan(0);
          });
        }
      }
    }
  });
});
