import { describe, it, expect } from "vitest";
import { sine } from "@strudel/core";
import { color } from "./color-pattern";
import { index, indexCycle } from "./index-patterns";
import { stackN } from "./grid-stack";
import { rand, rand2, choose, degradeBy, degrade, sometimesBy } from "./event-random";
import "./visual-controls";

function queryAlpha(pat: any, t: number): number {
  return pat.queryArc(t, t + 0.001)[0]?.value?.alpha;
}

// ─── per-event stability ──────────────────────────────────────────────────────

describe("per-event rand stability (no flicker)", () => {
  it("same hap queried at different frame times returns the same rand value", () => {
    // color("red") fires once per cycle at onset 0; createMixParam queries rand at onset,
    // not frame time — so alpha stays constant across the whole hap's duration
    const pat = color("red").alpha(rand);
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.3);
    const v3 = queryAlpha(pat, 0.8);
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
  });

  it("sine (untagged) still animates — different values at different frame times", () => {
    const pat = color("red").alpha(sine);
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.4);
    expect(v1).not.toBe(v2);
  });

  it("haps at different onsets get different rand values naturally (no seeding needed)", () => {
    // "red blue" has two haps — rand at onset 0 vs rand at onset 0.5
    const pat = color("red blue").alpha(rand);
    const vRed = queryAlpha(pat, 0.1);   // onset 0
    const vBlue = queryAlpha(pat, 0.6);  // onset 0.5
    expect(vRed).not.toBe(vBlue);
  });

  it("rand2 is also stable per hap", () => {
    const pat = color("red").x(rand2);
    const v1 = pat.queryArc(0.1, 0.101)[0].value.x;
    const v2 = pat.queryArc(0.7, 0.701)[0].value.x;
    expect(v1).toBe(v2);
  });

  it("choose() is stable per hap", () => {
    const pat = color("red").alpha(choose(0.1, 0.5, 0.9));
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.5);
    expect(v1).toBe(v2);
  });

  it("rand.range() is stable per hap and within bounds", () => {
    const pat = color("red").alpha(rand.range(0.3, 0.7));
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.5);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThanOrEqual(0.3);
    expect(v1).toBeLessThanOrEqual(0.7);
  });

  it("rand.slow() is stable per hap", () => {
    const pat = color("red").alpha(rand.slow(2));
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.5);
    expect(v1).toBe(v2);
  });

  it("rand.mul() is stable per hap", () => {
    const pat = color("red").alpha(rand.mul(0.5));
    const v1 = queryAlpha(pat, 0.1);
    const v2 = queryAlpha(pat, 0.5);
    expect(v1).toBe(v2);
  });
});

// ─── decorrelation via index() ────────────────────────────────────────────────

describe("parallel instance decorrelation via index()", () => {
  it("two simultaneous slots get different rand values", () => {
    const pat = index(color("red").alpha(rand), color("blue").alpha(rand));
    const evs = pat.queryArc(0.1, 0.101);
    const red = evs.find((e: any) => e.value.color === "red");
    const blue = evs.find((e: any) => e.value.color === "blue");
    expect(red.value.alpha).not.toBe(blue.value.alpha);
  });

  it("slot values are stable across frame times", () => {
    const pat = index(color("red").alpha(rand), color("blue").alpha(rand));
    const v1 = pat.queryArc(0.1, 0.101).find((e: any) => e.value.color === "red").value.alpha;
    const v2 = pat.queryArc(0.4, 0.401).find((e: any) => e.value.color === "red").value.alpha;
    expect(v1).toBe(v2);
  });
});

// ─── decorrelation via indexCycle() ──────────────────────────────────────────

describe("parallel instance decorrelation via indexCycle()", () => {
  it("two simultaneous slots get different rand values", () => {
    const pat = indexCycle(color("red").alpha(rand), color("blue").alpha(rand));
    const evs = pat.queryArc(0.1, 0.101);
    const red = evs.find((e: any) => e.value.color === "red");
    const blue = evs.find((e: any) => e.value.color === "blue");
    expect(red.value.alpha).not.toBe(blue.value.alpha);
  });

  it("multiple copies of the same pattern get different values", () => {
    const pat = indexCycle(
      color("red").alpha(rand),
      color("red").alpha(rand),
      color("red").alpha(rand),
    );
    const alphas = pat.queryArc(0.1, 0.101).map((e: any) => e.value.alpha);
    expect(alphas).toHaveLength(3);
    // All 3 should differ
    expect(new Set(alphas).size).toBe(3);
  });
});

// ─── decorrelation via stackN() ───────────────────────────────────────────────

describe("parallel instance decorrelation via stackN()", () => {
  it("4 copies of same pattern get different rand values", () => {
    const pat = stackN(4, color("red").alpha(rand));
    const alphas = pat.queryArc(0.1, 0.101).map((e: any) => e.value.alpha);
    expect(alphas).toHaveLength(4);
    expect(new Set(alphas).size).toBeGreaterThan(1);
  });

  it("slot values are stable across frame times", () => {
    const pat = stackN(2, color("red").alpha(rand));
    const first1 = pat.queryArc(0.1, 0.101)[0].value.alpha;
    const first2 = pat.queryArc(0.5, 0.501)[0].value.alpha;
    expect(first1).toBe(first2);
  });
});

// ─── degradeBy / sometimesBy ─────────────────────────────────────────────────

describe("degradeBy()", () => {
  it("prob=0 keeps all events", () => {
    expect(color("red").degradeBy(0).queryArc(0.25, 0.251)).toHaveLength(1);
  });

  it("prob=1 removes all events", () => {
    expect(color("red").degradeBy(1).queryArc(0.25, 0.251)).toHaveLength(0);
  });

  it("function form: degradeBy(0)(pat) keeps all", () => {
    expect(degradeBy(0)(color("red")).queryArc(0.25, 0.251)).toHaveLength(1);
  });
});

describe("degrade()", () => {
  it("returns a pattern (doesn't crash)", () => {
    const evs = color("red blue green green green green green green")
      .degrade()
      .queryArc(0, 1);
    expect(evs.length).toBeGreaterThanOrEqual(0);
    expect(evs.length).toBeLessThanOrEqual(8);
  });
});

describe("sometimesBy()", () => {
  it("is exported and returns a valid pattern", () => {
    // Smoke test: sometimesBy is callable and produces a pattern with events
    const pat = sometimesBy(0.5, (p: any) => p.fast(2))(color("red").fast(8));
    const evs = pat.queryArc(0, 1);
    expect(evs.length).toBeGreaterThan(0);
  });
});
