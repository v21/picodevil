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
    get fillStyle() { return ""; },
    set fillStyle(_v: any) {},
    _pat: pat,
  } as unknown as CanvasRenderingContext2D;
}

const dummySource = {} as CanvasImageSource;

describe("drawFit", () => {
  describe("cover", () => {
    it("scales up to fill, centered", () => {
      const ctx = mockCtx();
      // 100x50 source into 200x200 canvas: scale = max(200/100, 200/50) = 4
      drawFit(ctx, dummySource, 100, 50, 200, 200, "cover");
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(400); // 100 * 4
      expect(dh).toBe(200); // 50 * 4
      expect(dx).toBe(-100); // (200 - 400) / 2
      expect(dy).toBe(0);   // (200 - 200) / 2
    });

    it("with landscape source and portrait canvas", () => {
      const ctx = mockCtx();
      // 400x200 source into 100x300 canvas: scale = max(100/400, 300/200) = 1.5
      drawFit(ctx, dummySource, 400, 200, 100, 300, "cover");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(600); // 400 * 1.5
      expect(dh).toBe(300); // 200 * 1.5
      expect(dx).toBe(-250); // (100 - 600) / 2
      expect(dy).toBe(0);
    });
  });

  describe("contain", () => {
    it("scales to fit inside, centered", () => {
      const ctx = mockCtx();
      // 100x50 source into 200x200 canvas: scale = min(200/100, 200/50) = 2
      drawFit(ctx, dummySource, 100, 50, 200, 200, "contain");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(200); // 100 * 2
      expect(dh).toBe(100); // 50 * 2
      expect(dx).toBe(0);   // (200 - 200) / 2
      expect(dy).toBe(50);  // (200 - 100) / 2
    });

    it("with portrait source", () => {
      const ctx = mockCtx();
      // 50x100 into 200x200: scale = min(200/50, 200/100) = 2
      drawFit(ctx, dummySource, 50, 100, 200, 200, "contain");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(100);
      expect(dh).toBe(200);
      expect(dx).toBe(50);
      expect(dy).toBe(0);
    });
  });

  describe("fill", () => {
    it("stretches to exact canvas size", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 300, 400, "fill");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dx).toBe(0);
      expect(dy).toBe(0);
      expect(dw).toBe(300);
      expect(dh).toBe(400);
    });
  });

  describe("none", () => {
    it("draws at natural size, centered", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 300, 400, "none");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(100);
      expect(dh).toBe(50);
      expect(dx).toBe(100); // (300 - 100) / 2
      expect(dy).toBe(175); // (400 - 50) / 2
    });

    it("source larger than canvas overflows centered", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 500, 600, 200, 200, "none");
      const [, _sx, _sy, _sw, _sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(500);
      expect(dh).toBe(600);
      expect(dx).toBe(-150); // (200 - 500) / 2
      expect(dy).toBe(-200); // (200 - 600) / 2
    });
  });

  describe("crop (no tiling)", () => {
    it("default crop args are identity (same dest as no-crop)", () => {
      const ctx = mockCtx();
      // 100x100 source, fill, explicit default crop
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0, 0, 1, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(0); expect(sy).toBe(0);
      expect(sw).toBe(100); expect(sh).toBe(100);
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(200); expect(dh).toBe(200);
    });

    it("cropw=0.5 halves effective source width — fill stretches to canvas", () => {
      const ctx = mockCtx();
      // Left half of 200x100 source, fill into 300x200 canvas
      drawFit(ctx, dummySource, 200, 100, 300, 200, "fill", 0, 0, 0.5, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(0); expect(sy).toBe(0);
      expect(sw).toBe(100); expect(sh).toBe(100); // 0.5*200, 1*100
      expect(dx).toBe(0); expect(dy).toBe(0);
      expect(dw).toBe(300); expect(dh).toBe(200);
    });

    it("crop center quarter — contain centers with letterbox", () => {
      const ctx = mockCtx();
      // cropx=0.25 cropy=0.25 cropw=0.5 croph=0.5 → 50x50 of 100x100 source into 200x200 canvas, contain
      // effective source: 50x50 → scale = min(200/50, 200/50) = 4 → dw=200, dh=200, dx=0, dy=0
      drawFit(ctx, dummySource, 100, 100, 200, 200, "contain", 0.25, 0.25, 0.5, 0.5);
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(25); expect(sy).toBe(25); // 0.25*100
      expect(sw).toBe(50); expect(sh).toBe(50);
      expect(dw).toBe(200); expect(dh).toBe(200);
      expect(dx).toBe(0); expect(dy).toBe(0);
    });

    it("crop source offset: cropx=0.5 starts at right half", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 200, 100, 200, 100, "fill", 0.5, 0, 0.5, 1);
      const [, sx, sy, sw, sh] = (ctx.drawImage as any).mock.calls[0];
      expect(sx).toBe(100); // 0.5 * 200
      expect(sy).toBe(0);
      expect(sw).toBe(100); // 0.5 * 200
      expect(sh).toBe(100);
    });

    it("cover with non-square crop region uses crop aspect ratio", () => {
      const ctx = mockCtx();
      // cropw=0.5, croph=1 on 200x100 source → effective 100x100; cover into 200x200: scale=2
      drawFit(ctx, dummySource, 200, 100, 200, 200, "cover", 0, 0, 0.5, 1);
      const [, _sx, _sy, _sw, _sh, _dx, _dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(200); // 100*2
      expect(dh).toBe(200); // 100*2
    });
  });

  describe("crop (negative = flip)", () => {
    it("cropw=-1: uses negative destW (horizontal flip), source full width", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 200, 200, "fill", 0, 0, -1, 1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sw).toBe(100); expect(sh).toBe(50); // full source
      expect(sx).toBe(0);   expect(sy).toBe(0);
      // dest: dx shifted right by dw, dw negative
      expect(dw).toBe(-200);
      expect(dx).toBe(200); // dx + |dw| = 200+(-(-200)) = original dx(0) + 200
      expect(dy).toBe(0);   expect(dh).toBe(200);
    });

    it("croph=-1: uses negative destH (vertical flip)", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 50, 200, 200, "fill", 0, 0, 1, -1);
      expect(ctx.drawImage).toHaveBeenCalledOnce();
      const [, , , , , dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dh).toBe(-200);
      expect(dy).toBe(200); // dy + |dh|
      expect(dx).toBe(0);   expect(dw).toBe(200);
    });

    it("cropw=-0.5: half width, flipped — dest width is half of canvas", () => {
      const ctx = mockCtx();
      // left half of 100x100 source, flipped, fill into 200x200 — dest is full 200x200
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0, 0, -0.5, 1);
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(sw).toBe(50); expect(sh).toBe(100);
      expect(sx).toBe(0);  expect(sy).toBe(0);
      expect(dw).toBe(-200);
      expect(dx).toBe(200);
      expect(dh).toBe(200); expect(dy).toBe(0);
    });

    it("fit calculation uses |cropw| for aspect ratio (contain, negative cropw)", () => {
      const ctx = mockCtx();
      // |cropw|=0.5, croph=1 on 100x100 source → effective 50x100 → portrait
      // contain into 200x200: scale=min(200/50, 200/100)=2 → dw=100, dh=200
      drawFit(ctx, dummySource, 100, 100, 200, 200, "contain", 0, 0, -0.5, 1);
      const [, , , , , dx, , dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(Math.abs(dw)).toBe(100);
      expect(Math.abs(dh)).toBe(200);
      expect(dw).toBe(-100); // flipped
      expect(dx).toBe(50 + 100); // original dx(50) + |dw|(100) = 150
    });
  });

  describe("crop (tiling)", () => {
    it("uses fillRect (not drawImage) when crop extends beyond [0,1]", () => {
      const ctx = mockCtx();
      // cropx = -0.1: left edge outside [0,1]
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0, 1.2, 1);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalledOnce();
    });

    it("uses fillRect when cropx+cropw > 1", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", 0, 0, 1.1, 1);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalledOnce();
    });

    it("calls createPattern with repeat on the source", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0, 1.2, 1);
      expect(ctx.createPattern).toHaveBeenCalledWith(dummySource, "repeat");
    });

    it("calls setTransform on the pattern", () => {
      const ctx = mockCtx() as any;
      drawFit(ctx, dummySource, 100, 100, 200, 200, "fill", -0.1, 0, 1.2, 1);
      expect(ctx._pat.setTransform).toHaveBeenCalledOnce();
    });
  });
});
