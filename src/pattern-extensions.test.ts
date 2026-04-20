import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import { Pattern, Hap } from "@strudel/core";
import "./pattern-extensions";
import "./visual-controls";
import "./index-patterns";
import { screen } from "./screen-pattern";
import { video } from "./video-pattern";

function queryVal(pat: any, t: number): number | undefined {
  const evs = pat.queryArc(t, t);
  return evs.length ? evs[0].value : undefined;
}

describe("lerp with pattern params", () => {
  it("accepts literal strings (existing behavior)", () => {
    const pat = mini("0 1").lerp("sine", "out");
    const v = queryVal(pat, 0);
    expect(v).toBeTypeOf("number");
  });

  it("accepts patterns for curve and direction", () => {
    // alternate between sine and quad easing each cycle
    const pat = mini("0 1").lerp(mini("sine quad"), mini("in out"));
    const v0 = queryVal(pat, 0);
    const v1 = queryVal(pat, 1.0);
    expect(v0).toBeTypeOf("number");
    expect(v1).toBeTypeOf("number");
  });

  it("reify handles single string as pattern", () => {
    const pat = mini("0 1").lerp("cubic", "in");
    // at t=0.25 (midpoint of first event "0"), should interpolate toward 1
    const v = queryVal(pat, 0.25);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('lerp with slow alternation: "<1 10>/10".lerp()', () => {
  // "<1 10>/10" produces two events over 20 cycles:
  //   [0, 10) → value 1
  //   [10, 20) → value 10
  // lerp() interpolates from cur.value to next.value over the current event's span.
  // collectEvents uses padding=1 (window of ~3 cycles), so when in the [10,20) span
  // the next event (value=1 at cycle 20) is out of the query window and next = cur.
  // Expected: ramps 1→10 over cycles 0–9, then holds flat at 10 over cycles 10–19.

  const pat = () => mini("<1 10>/10").lerp();

  it("starts at 1 at t=0", () => {
    expect(queryVal(pat(), 0)).toBeCloseTo(1, 3);
  });

  it("is midway between 1 and 10 at t=5", () => {
    const v = queryVal(pat(), 5);
    expect(v).toBeCloseTo(5.5, 1);
  });

  it("approaches 10 near the end of the first span (t=9.9)", () => {
    const v = queryVal(pat(), 9.9)!;
    expect(v).toBeGreaterThan(9);
    expect(v).toBeLessThanOrEqual(10);
  });

  it("is at 10 at t=10 (start of second span)", () => {
    expect(queryVal(pat(), 10)).toBeCloseTo(10, 3);
  });

  it("ramps back toward 1 at t=15 (mid second span)", () => {
    const v = queryVal(pat(), 15)!;
    // lerps from 10 → 1 over cycles 10–19; midpoint = 5.5
    expect(v).toBeCloseTo(5.5, 1);
  });
});

describe("spline with pattern params", () => {
  it("accepts literal number (existing behavior)", () => {
    const pat = mini("0 0.5 1").spline(0.5);
    const v = queryVal(pat, 0);
    expect(v).toBeTypeOf("number");
  });

  it("accepts a pattern for tension", () => {
    const pat = mini("0 0.5 1").spline(mini("0.3 0.8"));
    const v = queryVal(pat, 0);
    expect(v).toBeTypeOf("number");
    expect(v).not.toBeNaN();
  });
});

describe("*To field operators", () => {
  function queryObj(pat: any, t: number): any {
    const evs = pat.queryArc(t, t);
    return evs.length ? evs[0].value : undefined;
  }

  it("addTo adds to a specific key, preserving others", () => {
    const pat = mini("0 1").fmap((v: number) => ({ x: v, s: "a" }));
    const result = (pat as any).addOn("x", 0.5);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.5);
    expect(queryObj(result, 0.5)?.x).toBeCloseTo(1.5);
    expect(queryObj(result, 0)?.s).toBe("a");
  });

  it("mulTo multiplies a specific key", () => {
    const pat = mini("0.5 1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).mulOn("x", 2);
    expect(queryObj(result, 0)?.x).toBeCloseTo(1.0);
    expect(queryObj(result, 0.5)?.x).toBeCloseTo(2.0);
  });

  it("mulTo with missing key uses identity 1, not 0", () => {
    const pat = mini("1").fmap((_v: number) => ({ s: "a" })); // no x
    const result = (pat as any).mulOn("x", 2);
    expect(queryObj(result, 0)?.x).toBeCloseTo(2); // 1 * 2 = 2, not 0 * 2 = 0
  });

  it("addTo with missing key uses identity 0", () => {
    const pat = mini("1").fmap((_v: number) => ({ s: "a" }));
    const result = (pat as any).addOn("x", 0.5);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.5); // 0 + 0.5 = 0.5
  });

  it("setTo replaces a specific key", () => {
    const pat = mini("0 1").fmap((v: number) => ({ x: v, y: 0.5 }));
    const result = (pat as any).setOn("y", 0.9);
    expect(queryObj(result, 0)?.y).toBeCloseTo(0.9);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0);
  });

  it("addTo with mix combining: 2-step source + 3-step amount = more events per cycle", () => {
    const pat = mini("0 1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).addOn("x", mini("0 .1 .2"));
    const evs = result.queryArc(0, 1);
    expect(evs.length).toBeGreaterThan(2);
  });

  it("addTo with pattern key: mini('x y') alternates target field each cycle", () => {
    const pat = mini("1").fmap((_v: number) => ({ x: 0.2, y: 0.3 }));
    // key pattern alternates between "x" and "y" each cycle
    const result = (pat as any).addOn(mini("x y"), 0.1);
    expect(queryObj(result, 0.1)?.x).toBeCloseTo(0.3);  // first half: key="x", adds to x
    expect(queryObj(result, 0.6)?.y).toBeCloseTo(0.4);  // second half: key="y", adds to y
    expect(queryObj(result, 0.6)?.x).toBeCloseTo(0.2);  // x unchanged in second half
  });

  it("subTo subtracts from a specific key", () => {
    const pat = mini("1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).subOn("x", 0.3);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.7);
  });
});

describe("mapOn", () => {
  function queryObj(pat: any, t: number): any {
    const evs = pat.queryArc(t, t);
    return evs.length ? evs[0].value : undefined;
  }

  it("applies transform fn to a named field, returning a signal", () => {
    // x steps between .1 and -.1; lerp() smooths the x field
    const pat = mini("0 1").fmap((v: number) => ({ x: v === 0 ? 0.1 : -0.1, s: "a" }));
    const result = (pat as any).mapOn("x", (xPat: any) => xPat.lerp());
    // at t=0 it should be at 0.1 (start of lerp), mid-step it should be intermediate
    const atStart = queryObj(result, 0.0)?.x;
    const atMid = queryObj(result, 0.25)?.x;
    const atHalf = queryObj(result, 0.5)?.x;
    expect(atStart).toBeCloseTo(0.1, 3);
    expect(atHalf).toBeCloseTo(-0.1, 3);
    // mid-step value should be between the two extremes (lerped)
    expect(atMid).toBeGreaterThan(-0.1);
    expect(atMid).toBeLessThan(0.1);
  });

  it("preserves other fields in hap value", () => {
    const pat = mini("1").fmap((_v: number) => ({ x: 0.5, s: "myfile" }));
    const result = (pat as any).mapOn("x", (xPat: any) => xPat);
    expect(queryObj(result, 0)?.s).toBe("myfile");
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.5);
  });

  it("is equivalent to applying the transform directly on the control pattern", () => {
    // s("a").x(".1 -.1").mapOn("x", x=>x.lerp()) == s("a").x(".1 -.1".lerp())
    // We can't easily test screen() here, so use fmap to set x from a lerp source
    const raw = mini("0.1 -0.1").lerp();
    // Build mapOn version: set x from steps, then mapOn lerp
    const stepped = mini("0.1 -0.1").fmap((v: number) => ({ x: v, s: "a" }));
    const mapped = (stepped as any).mapOn("x", (xp: any) => xp.lerp());
    // Both should give identical values at several test points
    for (const t of [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      const rawVal = raw.queryArc(t, t)[0]?.value;
      const mappedVal = queryObj(mapped, t)?.x;
      expect(mappedVal).toBeCloseTo(rawVal, 4);
    }
  });

  it("produces intermediate values when source has _type (like screen pattern haps)", () => {
    // Simulates s("red").x(".1 -.1").mapOn("x", x => x.spline())
    const base = mini("0.1 -0.1").fmap((v: number) => ({ x: v, _type: "color", color: "red" }));
    const mapped = (base as any).mapOn("x", (xp: any) => xp.spline());
    const atStart = queryObj(mapped, 0.0)?.x;
    const atMid = queryObj(mapped, 0.25)?.x;
    const atHalf = queryObj(mapped, 0.5)?.x;
    expect(atStart).toBeCloseTo(0.1, 3);
    expect(atHalf).toBeCloseTo(-0.1, 3);
    expect(atMid).toBeGreaterThan(-0.1);
    expect(atMid).toBeLessThan(0.1);
  });

  it("fieldPat.queryArc returns haps (not 0) — regression for browser failure", () => {
    // In the browser, fieldPat.query(state) returned 6 haps but fieldPat.queryArc(0,2) returned 0.
    // This test directly checks that queryArc works on the fieldPat built inside mapOn,
    // by using screen() which wraps in a new PatternClass like the real app does.
    const src = (screen("red") as any).x(mini(".1 -.1"));
    const fieldPat = new (Pattern as any)((state: any) => {
      return src.query(state).flatMap((hap: any) => {
        const v = hap.value?.x;
        if (v === undefined) return [];
        return [new (Hap as any)(hap.part, hap.part, Number(v))];
      });
    });
    const viaQueryArc = fieldPat.queryArc(0, 2);
    expect(viaQueryArc.length).toBeGreaterThan(0);
  });

  it("produces intermediate values when source whole spans don't match part spans (addOn case)", () => {
    // s("red").x(".1 -.1") goes through addOn which creates two events with
    // whole=[0,1] (from the source) but parts [0,0.5] and [0.5,1].
    // If fieldPat uses whole for timing, collectEvents sees both events at begin=0
    // and deduplicates to a single point — no interpolation possible.
    // Using part as the timing anchor fixes this.
    const src = mini("red").fmap(() => ({ _type: "color", color: "red" }));
    const withX = (src as any).addOn("x", mini("0.1 -0.1"));
    const mapped = (withX as any).mapOn("x", (xp: any) => xp.spline());
    const atMid = queryObj(mapped, 0.25)?.x;
    expect(atMid).toBeGreaterThan(-0.1);
    expect(atMid).toBeLessThan(0.1);
  });
});

describe("chopStack", () => {
  it("produces n simultaneous haps with correct begin/end", () => {
    const evs = (video("a.mp4") as any).chopStack(4).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    const slices = evs.map((e: any) => ({ begin: e.value.begin, end: e.value.end }));
    expect(slices[0]).toEqual({ begin: 0, end: 0.25 });
    expect(slices[1]).toEqual({ begin: 0.25, end: 0.5 });
    expect(slices[2]).toEqual({ begin: 0.5, end: 0.75 });
    expect(slices[3]).toEqual({ begin: 0.75, end: 1 });
  });

  it("all haps share the same whole/part spans as the original", () => {
    const orig = video("a.mp4").queryArc(0, 1)[0];
    const evs = (video("a.mp4") as any).chopStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(Number(ev.whole.begin)).toBeCloseTo(Number(orig.whole.begin));
      expect(Number(ev.whole.end)).toBeCloseTo(Number(orig.whole.end));
      expect(Number(ev.part.begin)).toBeCloseTo(Number(orig.part.begin));
      expect(Number(ev.part.end)).toBeCloseTo(Number(orig.part.end));
    }
  });

  it("sets i and count on each slice", () => {
    const evs = (video("a.mp4") as any).chopStack(4).queryArc(0, 1);
    expect(evs.map((e: any) => e.value.i)).toEqual([0, 1, 2, 3]);
    expect(evs.map((e: any) => e.value.count)).toEqual([4, 4, 4, 4]);
  });

  it("does not set layoutParent (slices are individually indexable)", () => {
    const evs = (video("a.mp4") as any).chopStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value.layoutParent).toBeUndefined();
    }
  });

  it("composes with prior begin/end", () => {
    // .begin(0.5).end(1).chopStack(2) should slice within the 0.5–1.0 region
    const evs = (video("a.mp4") as any).begin(0.5).end(1).chopStack(2).queryArc(0, 1);
    expect(evs).toHaveLength(2);
    expect(evs[0].value.begin).toBeCloseTo(0.5);
    expect(evs[0].value.end).toBeCloseTo(0.75);
    expect(evs[1].value.begin).toBeCloseTo(0.75);
    expect(evs[1].value.end).toBeCloseTo(1.0);
  });

  it("preserves _type on video events", () => {
    const evs = (video("a.mp4") as any).chopStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
    }
  });

  it("index() after chopStack on a stack re-indexes all slices across sources", () => {
    const pat = (video("a.mp4") as any).stack(video("b.mp4")).chopStack(4);
    const evs = (pat as any).index().queryArc(0, 1);
    expect(evs).toHaveLength(8);
    const iVals = evs.map((e: any) => e.value.i).sort((a: number, b: number) => a - b);
    expect(iVals).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(evs[0].value.count).toBe(8);
  });
});

describe("syncStack", () => {
  it("produces n simultaneous haps with sync set to i/n", () => {
    const evs = (video("a.mp4") as any).syncStack(4).queryArc(0, 1);
    expect(evs).toHaveLength(4);
    expect(evs.map((e: any) => e.value.sync)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("sets i and count on each copy", () => {
    const evs = (video("a.mp4") as any).syncStack(4).queryArc(0, 1);
    expect(evs.map((e: any) => e.value.i)).toEqual([0, 1, 2, 3]);
    expect(evs.map((e: any) => e.value.count)).toEqual([4, 4, 4, 4]);
  });

  it("all copies share the same whole/part spans", () => {
    const orig = video("a.mp4").queryArc(0, 1)[0];
    const evs = (video("a.mp4") as any).syncStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(Number(ev.whole.begin)).toBeCloseTo(Number(orig.whole.begin));
      expect(Number(ev.whole.end)).toBeCloseTo(Number(orig.whole.end));
    }
  });

  it("does not set layoutParent", () => {
    const evs = (video("a.mp4") as any).syncStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value.layoutParent).toBeUndefined();
    }
  });

  it("preserves existing event values", () => {
    const evs = (video("a.mp4") as any).syncStack(4).queryArc(0, 1);
    for (const ev of evs) {
      expect(ev.value._type).toBe("video");
      expect(ev.value.src).toBe("a.mp4");
    }
  });
});
