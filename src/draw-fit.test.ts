import { describe, it, expect, vi } from "vitest";
import { drawFit } from "./draw-fit";

function mockCtx() {
  return {
    drawImage: vi.fn(),
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
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(400); // 100 * 4
      expect(dh).toBe(200); // 50 * 4
      expect(dx).toBe(-100); // (200 - 400) / 2
      expect(dy).toBe(0);   // (200 - 200) / 2
    });

    it("with landscape source and portrait canvas", () => {
      const ctx = mockCtx();
      // 400x200 source into 100x300 canvas: scale = max(100/400, 300/200) = 1.5
      drawFit(ctx, dummySource, 400, 200, 100, 300, "cover");
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
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
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(200); // 100 * 2
      expect(dh).toBe(100); // 50 * 2
      expect(dx).toBe(0);   // (200 - 200) / 2
      expect(dy).toBe(50);  // (200 - 100) / 2
    });

    it("with portrait source", () => {
      const ctx = mockCtx();
      // 50x100 into 200x200: scale = min(200/50, 200/100) = 2
      drawFit(ctx, dummySource, 50, 100, 200, 200, "contain");
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
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
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
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
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(100);
      expect(dh).toBe(50);
      expect(dx).toBe(100); // (300 - 100) / 2
      expect(dy).toBe(175); // (400 - 50) / 2
    });

    it("source larger than canvas overflows centered", () => {
      const ctx = mockCtx();
      drawFit(ctx, dummySource, 500, 600, 200, 200, "none");
      const [, dx, dy, dw, dh] = (ctx.drawImage as any).mock.calls[0];
      expect(dw).toBe(500);
      expect(dh).toBe(600);
      expect(dx).toBe(-150); // (200 - 500) / 2
      expect(dy).toBe(-200); // (200 - 600) / 2
    });
  });
});
