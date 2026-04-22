/**
 * Tests for createMixParam visual controls registered on Pattern.prototype.
 * Uses object-valued patterns (as video/color/image would produce).
 *
 * Since these tests don't go through the transpiler, double-quoted strings
 * aren't auto-wrapped in mini(). We call mini() explicitly where needed.
 */
import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { sine, stack } from "@strudel/core";
import { index } from "./index-patterns";
import { stackN } from "./grid-stack";
import { rand } from "./event-random";
import "./visual-controls";

function query(pat: any, t: number) {
  const evs = pat.queryArc(t, t);
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

    it(".blend() merges blend mode", () => {
      const pat = src("x").blend(mini("multiply"));
      const v = query(pat, 0);
      expect(v.src).toBe("x");
      expect(v.blend).toBe("multiply");
    });

    it(".blend() alternates blend modes", () => {
      const pat = src("x").blend(mini("multiply screen"));
      expect(query(pat, 0.1).blend).toBe("multiply");
      expect(query(pat, 0.6).blend).toBe("screen");
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

  describe("position controls", () => {
    it(".x() merges x position", () => {
      expect(query(src("x").x(0.5), 0).x).toBe(0.5);
    });

    it(".y() merges y position", () => {
      expect(query(src("x").y(0.25), 0).y).toBe(0.25);
    });

    it(".width() merges width", () => {
      expect(query(src("x").width(0.5), 0).width).toBe(0.5);
    });

    it(".height() merges height", () => {
      expect(query(src("x").height(0.5), 0).height).toBe(0.5);
    });

    it(".grid(rows, cols, i) sets position for cell", () => {
      // cell 0 in 2x2: centre of top-left quarter
      const v0 = query(src("x").grid(2, 2, 0), 0);
      expect(v0.x).toBe(0.25);
      expect(v0.y).toBe(0.25);
      expect(v0.width).toBe(0.5);
      expect(v0.height).toBe(0.5);

      // cell 1 in 2x2: centre of top-right quarter
      const v1 = query(src("x").grid(2, 2, 1), 0);
      expect(v1.x).toBe(0.75);
      expect(v1.y).toBe(0.25);

      // cell 2 in 2x2: centre of bottom-left quarter
      const v2 = query(src("x").grid(2, 2, 2), 0);
      expect(v2.x).toBe(0.25);
      expect(v2.y).toBe(0.75);

      // cell 3 in 2x2: centre of bottom-right quarter
      const v3 = query(src("x").grid(2, 2, 3), 0);
      expect(v3.x).toBe(0.75);
      expect(v3.y).toBe(0.75);
    });

    it(".grid() composes with other controls", () => {
      const v = query(src("x").grid(2, 2, 0).alpha(0.5), 0);
      expect(v.x).toBe(0.25);
      expect(v.width).toBe(0.5);
      expect(v.alpha).toBe(0.5);
    });

    it(".grid() with pattern index alternates position", () => {
      // i alternates: cell 0 first half, cell 3 second half
      const pat = src("x").grid(2, 2, mini("0 3"));
      const v0 = query(pat, 0.1);
      expect(v0).toMatchObject({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
      const v1 = query(pat, 0.6);
      expect(v1).toMatchObject({ x: 0.75, y: 0.75, width: 0.5, height: 0.5 });
    });

    it(".grid() with stacked pattern index gives simultaneous positions", () => {
      // "0,3" in mini = stack(0, 3) = both at once
      const pat = src("x").grid(2, 2, mini("0,3"));
      const evs = pat.queryArc(0, 0).map((e: any) => e.value);
      expect(evs).toHaveLength(2);
      evs.sort((a: any, b: any) => a.x - b.x);
      expect(evs[0]).toMatchObject({ x: 0.25, y: 0.25 });
      expect(evs[1]).toMatchObject({ x: 0.75, y: 0.75 });
    });

    it(".grid() with pattern cols", () => {
      // rows=1, cols alternates "2 3", i=0
      const pat = src("x").grid(1, mini("2 3"), 0);
      // first half: cols=2 → width=0.5
      const v0 = query(pat, 0.1);
      expect(v0).toMatchObject({ x: 0.25, y: 0.5, width: 0.5, height: 1 });
      // second half: cols=3 → width=1/3
      const v1 = query(pat, 0.6);
      expect(v1.width).toBeCloseTo(1/3);
    });

    it(".grid() with pattern rows", () => {
      // rows alternates "1 2", cols=2, i=0
      const pat = src("x").grid(mini("1 2"), 2, 0);
      const v0 = query(pat, 0.1);
      expect(v0).toMatchObject({ height: 1 });
      const v1 = query(pat, 0.6);
      expect(v1).toMatchObject({ height: 0.5 });
    });

    it(".grid() composes with existing position (nesting)", () => {
      // Inner: cell 0 of 1x2 → centre {x:0.25, y:0.5, w:0.5, h:1}
      // Outer: cell 1 of 1x2 → centre {x:0.75, y:0.5, w:0.5, h:1}
      // Composed: x=0.75+(0.25-0.5)*0.5=0.625, y=0.5+(0.5-0.5)*1=0.5, w=0.25, h=1
      const pat = src("x").grid(1, 2, 0).grid(1, 2, 1);
      const v = query(pat, 0);
      expect(v.x).toBeCloseTo(0.625);
      expect(v.y).toBeCloseTo(0.5);
      expect(v.width).toBeCloseTo(0.25);
      expect(v.height).toBeCloseTo(1);
    });

    it(".grid() nesting: inner cell in outer cell", () => {
      // Inner: cell 3 of 2x2 → centre {x:0.75, y:0.75, w:0.5, h:0.5}
      // Outer: cell 0 of 2x2 → centre {x:0.25, y:0.25, w:0.5, h:0.5}
      // Composed: x=0.25+(0.75-0.5)*0.5=0.375, y=0.25+(0.75-0.5)*0.5=0.375, w=0.25, h=0.25
      const pat = src("x").grid(2, 2, 3).grid(2, 2, 0);
      const v = query(pat, 0);
      expect(v.x).toBeCloseTo(0.375);
      expect(v.y).toBeCloseTo(0.375);
      expect(v.width).toBeCloseTo(0.25);
      expect(v.height).toBeCloseTo(0.25);
    });

    it(".left() is alias for .x()", () => {
      expect(query(src("x").left(0.5), 0).x).toBe(0.5);
    });

    it(".top() is alias for .y()", () => {
      expect(query(src("x").top(0.25), 0).y).toBe(0.25);
    });

    it(".w() is alias for .width()", () => {
      expect(query(src("x").w(0.5), 0).width).toBe(0.5);
    });

    it(".h() is alias for .height()", () => {
      expect(query(src("x").h(0.5), 0).height).toBe(0.5);
    });

    it("position params are patternable", () => {
      const pat = src("x").x(sine);
      const v0 = query(pat, 0.0);
      const v25 = query(pat, 0.25);
      expect(v0.x).not.toBeCloseTo(v25.x, 1);
    });
  });

  describe("rotation controls", () => {
    it(".rotateZ() merges rotateZ value", () => {
      expect(query(src("x").rotateZ(0.25), 0).rotateZ).toBe(0.25);
    });

    it(".rotateX() merges rotateX value", () => {
      expect(query(src("x").rotateX(0.5), 0).rotateX).toBe(0.5);
    });

    it(".rotateY() merges rotateY value", () => {
      expect(query(src("x").rotateY(0.1), 0).rotateY).toBe(0.1);
    });

    it(".rotateZ() is patternable with mini", () => {
      const pat = src("x").rotateZ(mini("0.25 0.5"));
      expect(query(pat, 0.1).rotateZ).toBe(0.25);
      expect(query(pat, 0.6).rotateZ).toBe(0.5);
    });

    it(".rotateX() is patternable with signal", () => {
      const pat = src("x").rotateX(sine);
      const v0 = query(pat, 0.0);
      const v25 = query(pat, 0.25);
      expect(v0.rotateX).not.toBeCloseTo(v25.rotateX, 1);
    });

    it(".rotate(turns) without axis sets rotateZ", () => {
      const v = query(src("x").rotate(0.25), 0);
      expect(v.rotateZ).toBe(0.25);
    });

    it(".rotate(turns, axis) sets rotate and rotateAxis", () => {
      const v = query(src("x").rotate(0.25, 0.5), 0);
      expect(v.rotate).toBe(0.25);
      expect(v.rotateAxis).toBe(0.5);
    });

    it(".rotate() with patterned axis", () => {
      const pat = src("x").rotate(0.25, mini("0 0.5"));
      expect(query(pat, 0.1).rotateAxis).toBe(0);
      expect(query(pat, 0.6).rotateAxis).toBe(0.5);
    });

    it("rotation composes with other controls", () => {
      const v = query(src("x").rotateZ(0.25).alpha(0.5), 0);
      expect(v.rotateZ).toBe(0.25);
      expect(v.alpha).toBe(0.5);
    });
  });

  describe("whole-span preservation", () => {
    function queryHap(pat: any, t: number) {
      return pat.queryArc(t, t)[0];
    }

    function wholeSpan(hap: any): [number, number] {
      return [Number(hap.whole.begin), Number(hap.whole.end)];
    }

    it(".slow(N).alpha(constant) preserves whole=0-N", () => {
      const pat = src("x").slow(8).alpha(0.5);
      const hap = queryHap(pat, 2.5);
      expect(hap.value.alpha).toBe(0.5);
      expect(wholeSpan(hap)).toEqual([0, 8]);
    });

    it(".slow(N).alpha(sine) preserves whole (signal doesn't destroy it)", () => {
      const pat = src("x").slow(4).alpha(sine);
      const hap = queryHap(pat, 1.5);
      expect(hap.value.alpha).toBeDefined();
      expect(wholeSpan(hap)).toEqual([0, 4]);
    });

    it(".slow(N).alpha(structured) preserves whole", () => {
      const pat = src("x").slow(4).alpha(mini("0.5 1"));
      const hap = queryHap(pat, 0.7); // second half of cycle → alpha=1
      expect(hap.value.alpha).toBe(1);
      expect(wholeSpan(hap)).toEqual([0, 4]);
    });

    it("chaining multiple controls preserves whole through the chain", () => {
      const pat = src("x").slow(4).alpha(0.5).speed(2).x(0.25);
      const hap = queryHap(pat, 1.5);
      expect(hap.value.alpha).toBe(0.5);
      expect(hap.value.speed).toBe(2);
      expect(hap.value.x).toBe(0.25);
      expect(wholeSpan(hap)).toEqual([0, 4]);
    });

    it(".slow(N).begin(v).end(v) preserves whole", () => {
      const pat = src("x").slow(8).begin(0.4).end(0.8);
      const hap = queryHap(pat, 3.0);
      expect(hap.value.begin).toBe(0.4);
      expect(hap.value.end).toBe(0.8);
      expect(wholeSpan(hap)).toEqual([0, 8]);
    });

    it("without slow, whole is 0-1 (single cycle)", () => {
      const pat = src("x").alpha(0.5);
      const hap = queryHap(pat, 0.5);
      expect(wholeSpan(hap)).toEqual([0, 1]);
    });
  });

  describe(".tile()", () => {
    function queryAll(pat: any, t: number) {
      return pat.queryArc(t, t).map((h: any) => h.value);
    }

    it("1 element fills full screen", () => {
      const pat = index(src("a")).tile();
      const vs = queryAll(pat, 0);
      expect(vs).toHaveLength(1);
      expect(vs[0]).toMatchObject({ x: 0.5, y: 0.5, width: 1, height: 1 });
    });

    it("4 elements → 2×2 uniform grid", () => {
      const pat = index(src("a"), src("b"), src("c"), src("d")).tile();
      const vs = queryAll(pat, 0).sort((a: any, b: any) => a.i - b.i);
      expect(vs).toHaveLength(4);
      expect(vs[0]).toMatchObject({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
      expect(vs[1]).toMatchObject({ x: 0.75, y: 0.25, width: 0.5, height: 0.5 });
      expect(vs[2]).toMatchObject({ x: 0.25, y: 0.75, width: 0.5, height: 0.5 });
      expect(vs[3]).toMatchObject({ x: 0.75, y: 0.75, width: 0.5, height: 0.5 });
    });

    it("7 elements → 3 rows, top row has 3, bottom two have 2", () => {
      const pats = [src("a"), src("b"), src("c"), src("d"), src("e"), src("f"), src("g")];
      const pat = index(...pats).tile();
      const vs = queryAll(pat, 0).sort((a: any, b: any) => a.i - b.i);
      expect(vs).toHaveLength(7);
      // rows=3, distribution: 3,2,2
      expect(vs[0].width).toBeCloseTo(1 / 3);
      expect(vs[0]).toMatchObject({ y: 1 / 6, height: 1 / 3 });
      expect(vs[3].width).toBeCloseTo(0.5);
      expect(vs[3].y).toBeCloseTo(0.5);
      expect(vs[5].width).toBeCloseTo(0.5);
      expect(vs[5].y).toBeCloseTo(5 / 6);
    });

    it("9 elements → 3×3 uniform grid", () => {
      const pats = Array.from({ length: 9 }, (_, i) => src(`${i}`));
      const pat = index(...pats).tile();
      const vs = queryAll(pat, 0);
      expect(vs).toHaveLength(9);
      expect(vs[0].width).toBeCloseTo(1 / 3);
      expect(vs[0].height).toBeCloseTo(1 / 3);
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

describe(".scrub()", () => {
  it("scrub(0.5) freezes at midpoint of full video", () => {
    const v = query((src("a") as any).scrub(0.5), 0.1);
    expect(v.begin).toBeCloseTo(0.5);
    expect(v.end).toBeCloseTo(0.5);
  });

  it("scrub(0.5) with begin/end uses region", () => {
    const v = query((src("a") as any).begin(0.2).end(0.8).scrub(0.5), 0.1);
    expect(v.begin).toBeCloseTo(0.5);
    expect(v.end).toBeCloseTo(0.5);
  });

  it("scrub(0) pins to begin of region", () => {
    const v = query((src("a") as any).begin(0.2).end(0.8).scrub(0), 0.1);
    expect(v.begin).toBeCloseTo(0.2);
    expect(v.end).toBeCloseTo(0.2);
  });

  it("scrub(1) pins to end of region", () => {
    const v = query((src("a") as any).begin(0.2).end(0.8).scrub(1), 0.1);
    expect(v.begin).toBeCloseTo(0.8);
    expect(v.end).toBeCloseTo(0.8);
  });

  it("scrub(sine) animates — different values at different frame times", () => {
    const pat = (src("a") as any).scrub(sine);
    // Use t=0 (sine=0) and t=0.25 (sine peak=1) to avoid symmetry traps
    const v1 = query(pat, 0.0);
    const v2 = query(pat, 0.25);
    expect(v1.begin).not.toBeCloseTo(v2.begin);
  });

  it("scrub(rand) — stackN slots get different values", () => {
    const pat = stackN(4, src("a")).scrub(rand as any);
    const evs = pat.queryArc(0.1, 0.1);
    const begins = evs.map((e: any) => e.value.begin);
    expect(begins).toHaveLength(4);
    expect(new Set(begins.map((b: number) => b.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("scrub(sine.late(rand.segment(1))) animates AND differs across stackN slots", () => {
    const pat = stackN(4, src("a")).scrub(sine.late((rand as any).segment(1)));
    // Check animation: same slot, different frame times (use t=0 vs t=0.25 to avoid symmetry)
    const slot0_t1 = pat.queryArc(0.0, 0.0)[0]?.value.begin;
    const slot0_t2 = pat.queryArc(0.25, 0.25)[0]?.value.begin;
    expect(slot0_t1).not.toBeCloseTo(slot0_t2);  // animates
    // Check decorrelation: different slots at same frame time
    const evs = pat.queryArc(0.1, 0.1);
    const begins = evs.map((e: any) => e.value.begin);
    expect(new Set(begins.map((b: number) => b.toFixed(6))).size).toBeGreaterThan(1);  // different per slot
  });
});

describe(".duration()", () => {
  it("duration sets end = begin + value", () => {
    const v = query((src("a") as any).begin(0.2).duration(0.3), 0.1);
    expect(v.begin).toBeCloseTo(0.2);
    expect(v.end).toBeCloseTo(0.5);
  });

  it("duration with default begin (0)", () => {
    const v = query((src("a") as any).duration(0.25), 0.1);
    // begin is not explicitly set (renderer defaults it to 0); only end is computed
    expect(v.begin).toBeUndefined();
    expect(v.end).toBeCloseTo(0.25);
  });

  it("duration(rand) — stackN slots get different end values", () => {
    const pat = stackN(4, src("a")).duration(rand as any);
    const evs = pat.queryArc(0.1, 0.1);
    const ends = evs.map((e: any) => e.value.end);
    expect(ends).toHaveLength(4);
    expect(new Set(ends.map((b: number) => b.toFixed(6))).size).toBeGreaterThan(1);
  });
});
