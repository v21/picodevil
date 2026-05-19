import { describe, it, expect, inject } from "vitest";
import { parse, type Font } from "opentype.js";
import { renderTextOpentype } from "./text-render-opentype";

function loadFont(): Font {
  const b64 = inject('heptaSlabTTF') as string;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return parse(bytes.buffer as ArrayBuffer);
}

describe("renderTextOpentype variable font", () => {
  it("wght=1 and wght=900 for Hepta Slab produce visually different renders", () => {
    const font = loadFont();
    const thin = renderTextOpentype('WWWWWWWW', font, 128, { wght: 1 }, 'white');
    const bold = renderTextOpentype('WWWWWWWW', font, 128, { wght: 900 }, 'white');

    const thinCtx = thin.getContext('2d')!;
    const boldCtx = bold.getContext('2d')!;
    const w = Math.min(thin.width, bold.width);
    const h = Math.min(thin.height, bold.height);
    const thinPx = thinCtx.getImageData(0, 0, w, h).data;
    const boldPx = boldCtx.getImageData(0, 0, w, h).data;

    let diffCount = 0;
    for (let i = 0; i < thinPx.length; i++) {
      if (thinPx[i] !== boldPx[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(100);
  });
});
