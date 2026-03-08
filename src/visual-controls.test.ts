/**
 * Tests for createMixParam visual controls registered on Pattern.prototype.
 * Uses object-valued patterns (as video/color/image would produce).
 *
 * Since these tests don't go through the transpiler, double-quoted strings
 * aren't auto-wrapped in mini(). We call mini() explicitly where needed.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { sine } from "@strudel/core";
import "./visual-controls";

function query(pat: any, t: number) {
  const evs = pat.queryArc(t, t + 0.001);
  return evs.length ? evs[0].value : undefined;
}

/** Simulates what video("a.mp4 b.mp4") will produce after the rewrite. */
function src(pat: string) {
  return mini(pat).withValue((v: string) => ({ src: v }));
}

describe("visual controls via createMixParam", () => {
  describe("as methods on Pattern", () => {
    it(".speed() merges speed into object-valued events", () => {
      const pat = src("a.mp4 b.mp4").speed(mini("0.5 1"));
      const v = query(pat, 0.1);
      expect(v.src).toBe("a.mp4");
      expect(v.speed).toBe(0.5);
    });

    it(".alpha() merges alpha", () => {
      const pat = src("x").alpha(mini("0.5"));
      const v = query(pat, 0);
      expect(v.src).toBe("x");
      expect(v.alpha).toBe(0.5);
    });

    it(".scaleX() merges scaleX", () => {
      expect(query(src("x").scaleX(mini("2")), 0).scaleX).toBe(2);
    });

    it(".scaleY() merges scaleY", () => {
      expect(query(src("x").scaleY(mini("3")), 0).scaleY).toBe(3);
    });

    it("chaining multiple controls merges all keys", () => {
      const pat = src("clip.mp4").speed(mini("2")).alpha(mini("0.5"));
      const v = query(pat, 0);
      expect(v.src).toBe("clip.mp4");
      expect(v.speed).toBe(2);
      expect(v.alpha).toBe(0.5);
    });

    it("numeric values pass through as numbers", () => {
      const pat = src("x").speed(0.5);
      expect(query(pat, 0).speed).toBe(0.5);
    });

    it("later control overrides earlier with same name", () => {
      const pat = src("x").speed(mini("1")).speed(mini("2"));
      expect(query(pat, 0).speed).toBe(2);
    });
  });

  describe("frame-time sampling with continuous signals", () => {
    it(".speed(sine) samples sine at frame time, not cycle start", () => {
      const pat = src("clip.mp4").speed(sine);
      const v0 = query(pat, 0.0);
      const v25 = query(pat, 0.25);
      const v50 = query(pat, 0.5);
      // sine: 0.5 at t=0, 1.0 at t=0.25, 0.5 at t=0.5
      expect(v0.speed).toBeCloseTo(0.5, 1);
      expect(v25.speed).toBeCloseTo(1.0, 1);
      expect(v50.speed).toBeCloseTo(0.5, 1);
      expect(v0.src).toBe("clip.mp4");
    });

    it(".alpha(sine) varies across cycle", () => {
      const pat = src("x").alpha(sine);
      const a0 = query(pat, 0.0).alpha;
      const a25 = query(pat, 0.25).alpha;
      expect(a0).not.toBeCloseTo(a25, 1);
    });
  });

  describe("discrete param patterns", () => {
    it("speed alternates with src", () => {
      const pat = src("a.mp4 b.mp4").speed(mini("0.5 2"));
      expect(query(pat, 0.1).speed).toBe(0.5);
      expect(query(pat, 0.6).speed).toBe(2);
    });

    it("alpha alternates across cycle", () => {
      const pat = src("x y").alpha(mini("0.3 0.8"));
      expect(query(pat, 0.1).alpha).toBe(0.3);
      expect(query(pat, 0.6).alpha).toBe(0.8);
    });
  });

  describe("standalone functions", () => {
    it("speed as standalone wraps value", async () => {
      const { speed } = await import("./visual-controls");
      const pat = speed(0.5);
      expect(query(pat, 0)).toEqual({ speed: 0.5 });
    });

    it("speed as standalone with base pattern", async () => {
      const { speed } = await import("./visual-controls");
      const pat = speed(0.5, src("clip.mp4"));
      const v = query(pat, 0);
      expect(v.src).toBe("clip.mp4");
      expect(v.speed).toBe(0.5);
    });
  });
});
