/**
 * Tests for Strudel's .seed() method — verifies that different seeds
 * produce different random values, and same seeds produce same values.
 * Relevant for decorrelating random patterns across grid cells.
 */
import { describe, it, expect } from "vitest";
import { rand } from "@strudel/core";

function queryValue(pat: any, t: number): number {
  const evs = pat.queryArc(t, t + 0.001);
  return evs.length ? Number(evs[0].value) : NaN;
}

describe("seed", () => {
  it("same seed produces same random values", () => {
    const a = rand.seed(42);
    const b = rand.seed(42);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      expect(queryValue(a, t)).toBe(queryValue(b, t));
    }
  });

  it("different seeds produce different random values", () => {
    const a = rand.seed(1);
    const b = rand.seed(2);
    const diffs = [0, 0.25, 0.5, 0.75].filter(
      (t) => queryValue(a, t) !== queryValue(b, t)
    );
    expect(diffs.length).toBeGreaterThan(0);
  });

  it("unseeded rand at same time gives same value", () => {
    const v1 = queryValue(rand, 0.3);
    const v2 = queryValue(rand, 0.3);
    expect(v1).toBe(v2);
  });

  it("seed works with pattern chains", () => {
    const a = rand.range(0, 100).seed(10);
    const b = rand.range(0, 100).seed(20);
    const va = queryValue(a, 0);
    const vb = queryValue(b, 0);
    expect(va).not.toBe(vb);
    expect(va).toBeGreaterThanOrEqual(0);
    expect(va).toBeLessThanOrEqual(100);
  });
});
