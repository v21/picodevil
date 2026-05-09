import { describe, it, expect, vi } from "vitest";
import { drawFit } from "./draw-fit";

function mockCtx() {
  const pat = { setTransform: vi.fn() };
  return {
    drawImage: vi.fn(),
    createPattern: vi.fn().mockReturnValue(pat),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    get fillStyle() { return ""; },
    set fillStyle(_v: any) {},
    _pat: pat,
  } as unknown as CanvasRenderingContext2D;
}

const dummySource = {} as CanvasImageSource;

describe("drawFit", () => {
  // Helper: get the translate call args (dx, dy passed to ctx.translate)
  function translateArgs(ctx: any) {
    return (ctx.translate as any).mock.calls[0] as [number, number];
  }

  describe("cover", () => {
    it("scales up to fill, centered", () => {
      const ctx = mockCtx();
      // 100x50 source into 200x200 canvas: scale = max(200/100, 200/50) = 4
      drawFit(ctx, dummySource, 100, 50, 200, 200, "cover");
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(400); // 100 * 4
      expect(dh).toBe(200); // 50 * 4
      // dx/dy are now in local coords (always 0); position comes from translate
      expect(dx).toBe(0); expect(dy).toBe(0);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(-100); // (200 - 400) / 2
      expect(ty).toBe(0);
    });

    it("with landscape source and portrait canvas", () => {
      const ctx = mockCtx();
      // 400x200 source into 100x300 canvas: scale = max(100/400, 300/200) = 1.5
      drawFit(ctx, dummySource, 400, 200, 100, 300, "cover");
      const [, _sx, _sy, _sw, _sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(600); // 400 * 1.5
      expect(dh).toBe(300); // 200 * 1.5
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(-250); // (100 - 600) / 2
      expect(ty).toBe(0);
    });
  });

  describe("contain", () => {
    it("scales to fit inside, centered", () => {
      const ctx = mockCtx();
      // 100x50 source into 200x200 canvas: scale = min(200/100, 200/50) = 2
      drawFit(ctx, dummySource, 100, 50, 200, 200, "contain");
      const [, _sx, _sy, _sw, _sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(200); // 100 * 2
      expect(dh).toBe(100); // 50 * 2
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(0);   // (200 - 200) / 2
      expect(ty).toBe(50);  // (200 - 100) / 2
    });

    it("with portrait source", () => {
      const ctx = mockCtx();
      // 50x100 into 200x200: scale = min(200/50, 200/100) = 2
      drawFit(ctx, dummySource, 50, 100, 200, 200, "contain");
      const [, , , , , , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(100);
      expect(dh).toBe(200);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(50);
      expect(ty).toBe(0);
    });
  });

  describe("fill", () => {
    it("stretches to exact canvas size", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 300, 400, "fill");
      const [, _sx, _sy, _sw, _sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(300);
      expect(dh).toBe(400);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(0);
      expect(ty).toBe(0);
    });
  });

  describe("tilecenter / none", () => {
    it("fills cell at native resolution, source centre aligned to cell centre, using createPattern", () => {
      const ctx = mockCtx();
      // 100x50 source, 300x400 cell; default cropx=0.5,cropy=0.5
      // centre of source = (50, 25); centre of cell = (150, 200)
      // pattern offset = (150-50, 200-25) = (100, 175)
      drawFit(ctx, dummySource, 100, 50, 300, 400, "tilecenter");
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.createPattern).toHaveBeenCalledWith(dummySource, "repeat");
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 300, 400);
      const pat = (ctx as any)._pat;
      const transform: DOMMatrix = (pat.setTransform as any).mock.calls[0][0];
      expect(transform.e).toBeCloseTo(100); // cw/2 - cropx*sw = 150 - 50
      expect(transform.f).toBeCloseTo(175); // ch/2 - cropy*sh = 200 - 25
      expect(transform.a).toBeCloseTo(1);   // native scale
    });

    it("none draws source at native pixel size centered in the cell", () => {
      const ctx = mockCtx();
      // source 100×50, cell 300×400 → display 100×50, centered: tx=100, ty=175
      drawFit(ctx, dummySource, 100, 50, 300, 400, "none");
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBeCloseTo(0);   expect(sy).toBeCloseTo(0);
      expect(sw).toBeCloseTo(100); expect(sh).toBeCloseTo(50);
      expect(dw).toBeCloseTo(100); expect(dh).toBeCloseTo(50);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBeCloseTo(100); // (300 - 100) / 2
      expect(ty).toBeCloseTo(175); // (400 -  50) / 2
    });

    it("cropx/cropy shift the centred anchor point", () => {
      const ctx = mockCtx();
      // cropx=0.75 → centre aligns at 0.75*100=75 px in source → offset = 150-75=75
      drawFit(ctx, dummySource, 100, 100, 300, 300, "tilecenter", 0.75, 0.25);
      const pat = (ctx as any)._pat;
      const transform: DOMMatrix = (pat.setTransform as any).mock.calls[0][0];
      expect(transform.e).toBeCloseTo(75);  // 150 - 0.75*100
      expect(transform.f).toBeCloseTo(125); // 150 - 0.25*100
    });
  });

  describe("tile", () => {
    it("fills cell at native resolution, top-left anchored, using createPattern", () => {
      const ctx = mockCtx();
      // 100x50 source, 300x400 cell
      drawFit(ctx, dummySource, 100, 50, 300, 400, "tile");
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.createPattern).toHaveBeenCalledWith(dummySource, "repeat");
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 300, 400);
      // pattern transform: translate(-sxOrigin, -syOrigin) = translate(0, 0) for default cropx=0.5, cropw=1
      const pat = (ctx as any)._pat;
      const transform: DOMMatrix = (pat.setTransform as any).mock.calls[0][0];
      expect(transform.e).toBeCloseTo(0); // translateX
      expect(transform.f).toBeCloseTo(0); // translateY
      // scale = 1 (native resolution)
      expect(transform.a).toBeCloseTo(1);
      expect(transform.d).toBeCloseTo(1);
    });

    it("offsets pattern when cropx/cropy shift the crop origin", () => {
      const ctx = mockCtx();
      // cropx=0.75, cropw=0.5 → cropLeft=(0.75-0.25)=0.5 → sxOrigin=0.5*100=50
      drawFit(ctx, dummySource, 100, 100, 200, 200, "tile", 0.75, 0.25, 0.5, 0.5);
      const pat = (ctx as any)._pat;
      const transform: DOMMatrix = (pat.setTransform as any).mock.calls[0][0];
      expect(transform.e).toBeCloseTo(-50); // -sxOrigin
      expect(transform.f).toBeCloseTo(0);   // -(0.25-0.25)*100 = 0
    });
  });

  describe("crop (no tiling)", () => {
    it("default crop args are identity (same dest as no-crop)", () => {
      const ctx = mockCtx();
      // 100x100 source, fill, explicit default crop (centre=0.5, full size=1)
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0.5, 0.5, 1, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(0); expect(sy).toBe(0);
      expect(sw).toBe(100); expect(sh).toBe(100);
      // dx/dy are local coords (always 0); translate carries position
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(200); expect(dh).toBe(200);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(0); expect(ty).toBe(0);
    });

    it("cropw=0.5 halves effective source width — fill stretches to canvas", () => {
      const ctx = mockCtx();
      // Left half of 200x100 source (centre at 0.25), fill into 300x200 canvas
      drawFit(ctx, dummySource, 200, 100, 300, 200, "fill", 0.25, 0.5, 0.5, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(0); expect(sy).toBe(0);
      expect(sw).toBe(100); expect(sh).toBe(100); // 0.5*200, 1*100
      expect(dw).toBe(300); expect(dh).toBe(200);
    });

    it("crop center quarter — contain centers with letterbox", () => {
      const ctx = mockCtx();
      // cropx=0.5 cropy=0.5 cropw=0.5 croph=0.5 → center 50x50 of 100x100 source into 200x200, contain
      // sxOrigin = (0.5-0.25)*100 = 25; effective source: 50x50 → scale=4 → dw=200, dh=200
      drawFit(ctx, dummySource, 100, 100, 200, 200, "contain", 0.5, 0.5, 0.5, 0.5);
      const [, sx, sy, sw, sh, , , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(25); expect(sy).toBe(25); // (0.5-0.25)*100
      expect(sw).toBe(50); expect(sh).toBe(50);
      expect(dw).toBe(200); expect(dh).toBe(200);
      const [tx, ty] = translateArgs(ctx);
      expect(tx).toBe(0); expect(ty).toBe(0);
    });

    it("crop right half: cropx=0.75 centres the crop window over the right half", () => {
      const ctx = mockCtx();
      // Centre at 0.75, width=0.5 → sxOrigin=(0.75-0.25)*200=100, sw=100
      drawFit(ctx, dummySource, 200, 100, 200, 100, "fill", 0.75, 0.5, 0.5, 1);
      const [, sx, sy, sw, sh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(100); // (0.75-0.25)*200
      expect(sy).toBe(0);
      expect(sw).toBe(100); // 0.5*200
      expect(sh).toBe(100);
    });

    it("cover with non-square crop region uses crop aspect ratio", () => {
      const ctx = mockCtx();
      // cropw=0.5, croph=1 on 200x100 source (left half, centre at 0.25) → effective 100x100; cover into 200x200: scale=2
      drawFit(ctx, dummySource, 200, 100, 200, 200, "cover", 0.25, 0.5, 0.5, 1);
      const [, _sx, _sy, _sw, _sh, _dx, _dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(200); // 100*2
      expect(dh).toBe(200); // 100*2
    });
  });

  describe("crop (negative = flip)", () => {
    it("cropw=-1: drawImage called with positive dw, translate+scale used for flip", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 200, 200, "fill", 0.5, 0.5, -1, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sw).toBe(100); expect(sh).toBe(50); // full source
      expect(sx).toBe(0);   expect(sy).toBe(0);
      // dest in local coords (after transform) — always positive
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(200); expect(dh).toBe(200);
    });

    it("croph=-1: drawImage called with positive dh, translate+scale used for flip", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 200, 200, "fill", 0.5, 0.5, 1, -1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, , , , , dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(200); expect(dh).toBe(200);
    });

    it("cropw=-0.5: left half, flipped — source sw=50, dest is full canvas size", () => {
      const ctx = mockCtx();
      // left half of 100x100 source (centre at 0.25), flipped, fill into 200x200
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0.25, 0.5, -0.5, 1);
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sw).toBe(50); expect(sh).toBe(100);
      expect(sx).toBe(0);  expect(sy).toBe(0);
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(200); expect(dh).toBe(200);
    });

    it("fit calculation uses |cropw| for aspect ratio (contain, negative cropw)", () => {
      const ctx = mockCtx();
      // |cropw|=0.5, croph=1 on 100x100 source (left half, centre at 0.25) → effective 50x100 → portrait
      // contain into 200x200: scale=min(200/50, 200/100)=2 → dw=100, dh=200
      drawFit(ctx, dummySource, 100, 100, 200, 200, "contain", 0.25, 0.5, -0.5, 1);
      const [, , , , , dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(100);
      expect(dh).toBe(200);
      expect(dx).toBe(0); expect(dy).toBe(0); // local coords
    });
  });

  describe("crop (tiling)", () => {
    it("uses fillRect (not drawImage) when crop window extends left of source", () => {
      const ctx = mockCtx();
      // centre=-0.1, width=1.2 → left edge = -0.1-0.6 = -0.7 < 0
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0.5, 1.2, 1);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalledOnce();
    });

    it("uses fillRect when crop window extends right of source", () => {
      const ctx = mockCtx();
      // centre=0.5, width=1.1 → right edge = 0.5+0.55 = 1.05 > 1
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0.5, 0.5, 1.1, 1);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalledOnce();
    });

    it("calls createPattern with repeat on the source", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0.5, 1.2, 1);
      expect(ctx.createPattern).toHaveBeenCalledWith(dummySource, "repeat");
    });

    it("calls setTransform on the pattern", () => {
      const ctx = mockCtx() as any;
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0.5, 1.2, 1);
      expect(ctx._pat.setTransform).toHaveBeenCalledOnce();
    });
  });
});
