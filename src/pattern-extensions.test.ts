import { describe, it, expect } from "vitest";
import { mini } from "@strudel/mini";
import "./pattern-extensions";

function queryVal(pat: any, t: number): number {
  const evs = pat.queryArc(t, t + 0.001);
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
