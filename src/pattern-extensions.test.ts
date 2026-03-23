import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import "./pattern-extensions";

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
    const result = (pat as any).addTo("x", 0.5);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.5);
    expect(queryObj(result, 0.5)?.x).toBeCloseTo(1.5);
    expect(queryObj(result, 0)?.s).toBe("a");
  });

  it("mulTo multiplies a specific key", () => {
    const pat = mini("0.5 1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).mulTo("x", 2);
    expect(queryObj(result, 0)?.x).toBeCloseTo(1.0);
    expect(queryObj(result, 0.5)?.x).toBeCloseTo(2.0);
  });

  it("mulTo with missing key uses identity 1, not 0", () => {
    const pat = mini("1").fmap((_v: number) => ({ s: "a" })); // no x
    const result = (pat as any).mulTo("x", 2);
    expect(queryObj(result, 0)?.x).toBeCloseTo(2); // 1 * 2 = 2, not 0 * 2 = 0
  });

  it("addTo with missing key uses identity 0", () => {
    const pat = mini("1").fmap((_v: number) => ({ s: "a" }));
    const result = (pat as any).addTo("x", 0.5);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.5); // 0 + 0.5 = 0.5
  });

  it("setTo replaces a specific key", () => {
    const pat = mini("0 1").fmap((v: number) => ({ x: v, y: 0.5 }));
    const result = (pat as any).setTo("y", 0.9);
    expect(queryObj(result, 0)?.y).toBeCloseTo(0.9);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0);
  });

  it("addTo with mix combining: 2-step source + 3-step amount = more events per cycle", () => {
    const pat = mini("0 1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).addTo("x", mini("0 .1 .2"));
    const evs = result.queryArc(0, 1);
    expect(evs.length).toBeGreaterThan(2);
  });

  it("addTo with pattern key: mini('x y') alternates target field each cycle", () => {
    const pat = mini("1").fmap((_v: number) => ({ x: 0.2, y: 0.3 }));
    // key pattern alternates between "x" and "y" each cycle
    const result = (pat as any).addTo(mini("x y"), 0.1);
    expect(queryObj(result, 0.1)?.x).toBeCloseTo(0.3);  // first half: key="x", adds to x
    expect(queryObj(result, 0.6)?.y).toBeCloseTo(0.4);  // second half: key="y", adds to y
    expect(queryObj(result, 0.6)?.x).toBeCloseTo(0.2);  // x unchanged in second half
  });

  it("subTo subtracts from a specific key", () => {
    const pat = mini("1").fmap((v: number) => ({ x: v }));
    const result = (pat as any).subTo("x", 0.3);
    expect(queryObj(result, 0)?.x).toBeCloseTo(0.7);
  });
});
