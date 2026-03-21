/**
 * Property-based invariant tests for shuffleStack / shuffleStackCycle.
 *
 * These verify invariants that must hold for ANY inputs:
 * - Event count preservation
 * - Permutation validity (all original events present)
 * - Determinism (same seed → same result)
 * - Seed independence (different seeds → same set of values)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { stack, steady } from "@strudel/core";
import { color } from "./color-pattern";
import "./visual-controls";
import "./index-patterns";
import "./shuffle-stack";

// ─── Helpers ────────────────────────────────────────────────────────────────

function queryAt(pat: any, t: number) {
  return pat.queryArc(t, t);
}

function queryWide(pat: any, start: number, end: number) {
  return pat.queryArc(start, end);
}

const ALL_COLORS = ["red", "blue", "green", "yellow", "cyan", "magenta", "purple", "orange"];

function colorStack(n: number) {
  return stack(...ALL_COLORS.slice(0, n).map(c => color(c)));
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const stackSize = fc.integer({ min: 2, max: 8 });
const seed = fc.integer({ min: 0, max: 10000 });
// Use mid-cycle query times to avoid cycle boundary edge cases
const queryTime = fc.double({ min: 0.01, max: 0.99, noNaN: true });
const RUNS = 50;

// ─── shuffleStack invariants ────────────────────────────────────────────────

describe("shuffleStack invariants", () => {
  it("preserves event count", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      expect(queryAt(base.shuffleStack(s), t)).toHaveLength(queryAt(base, t).length);
    }), { numRuns: RUNS });
  });

  it("preserves the set of values (permutation, not sampling)", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      const original = new Set(queryAt(base, t).map((h: any) => h.value.color));
      const shuffled = new Set(queryAt(base.shuffleStack(s), t).map((h: any) => h.value.color));
      expect(shuffled).toEqual(original);
    }), { numRuns: RUNS });
  });

  it("is deterministic: same seed → same order", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      const run1 = queryAt(base.shuffleStack(s), t).map((h: any) => h.value.color);
      const run2 = queryAt(base.shuffleStack(s), t).map((h: any) => h.value.color);
      expect(run1).toEqual(run2);
    }), { numRuns: RUNS });
  });

  it("different seeds preserve the same set of values", () => {
    fc.assert(fc.property(stackSize, seed, seed, queryTime, (n, s1, s2, t) => {
      const base = colorStack(n);
      const set1 = new Set(queryAt(base.shuffleStack(s1), t).map((h: any) => h.value.color));
      const set2 = new Set(queryAt(base.shuffleStack(s2), t).map((h: any) => h.value.color));
      expect(set1).toEqual(set2);
    }), { numRuns: RUNS });
  });

  it("default seed is stable across time and cycles", () => {
    fc.assert(fc.property(stackSize, (n) => {
      const shuffled = colorStack(n).shuffleStack();
      const t1 = queryAt(shuffled, 0.1).map((h: any) => h.value.color);
      const t2 = queryAt(shuffled, 0.7).map((h: any) => h.value.color);
      const t3 = queryAt(shuffled, 3.3).map((h: any) => h.value.color);
      expect(t1).toEqual(t2);
      expect(t2).toEqual(t3);
    }), { numRuns: RUNS });
  });

  it("single-element stack is identity regardless of seed", () => {
    fc.assert(fc.property(seed, queryTime, (s, t) => {
      const original = queryAt(color("red"), t).map((h: any) => h.value.color);
      const shuffled = queryAt(color("red").shuffleStack(s), t).map((h: any) => h.value.color);
      expect(shuffled).toEqual(original);
    }), { numRuns: RUNS });
  });

  it("works with steady values: preserves count and set", () => {
    const values = fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 6 });
    fc.assert(fc.property(values, seed, queryTime, (vals, s, t) => {
      const base = stack(...vals.map(v => steady(v)));
      const original = queryAt(base, t).map((h: any) => h.value);
      const shuffled = queryAt(base.shuffleStack(s), t).map((h: any) => h.value);
      expect(shuffled).toHaveLength(original.length);
      expect(new Set(shuffled)).toEqual(new Set(original));
    }), { numRuns: RUNS });
  });

  it("preserves count with mixed subdivisions", () => {
    fc.assert(fc.property(seed, queryTime, (s, t) => {
      const base = stack(color("red blue"), color("green"), color("yellow cyan purple"));
      const original = queryAt(base, t);
      const shuffled = queryAt(base.shuffleStack(s), t);
      expect(shuffled).toHaveLength(original.length);
    }), { numRuns: RUNS });
  });
});

// ─── shuffleStackCycle invariants ───────────────────────────────────────────

describe("shuffleStackCycle invariants", () => {
  it("preserves event count", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      expect(queryAt(base.shuffleStackCycle(s), t)).toHaveLength(queryAt(base, t).length);
    }), { numRuns: RUNS });
  });

  it("preserves the set of values", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      const original = new Set(queryAt(base, t).map((h: any) => h.value.color));
      const shuffled = new Set(queryAt(base.shuffleStackCycle(s), t).map((h: any) => h.value.color));
      expect(shuffled).toEqual(original);
    }), { numRuns: RUNS });
  });

  it("is deterministic: same seed → same order", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const base = colorStack(n);
      const run1 = queryAt(base.shuffleStackCycle(s), t).map((h: any) => h.value.color);
      const run2 = queryAt(base.shuffleStackCycle(s), t).map((h: any) => h.value.color);
      expect(run1).toEqual(run2);
    }), { numRuns: RUNS });
  });

  it("default seed is stable across cycles", () => {
    fc.assert(fc.property(stackSize, (n) => {
      const shuffled = colorStack(n).shuffleStackCycle();
      const t1 = queryAt(shuffled, 0.1).map((h: any) => h.value.color);
      const t2 = queryAt(shuffled, 1.1).map((h: any) => h.value.color);
      const t3 = queryAt(shuffled, 5.1).map((h: any) => h.value.color);
      expect(t1).toEqual(t2);
      expect(t2).toEqual(t3);
    }), { numRuns: RUNS });
  });

  it("wide query preserves event count", () => {
    fc.assert(fc.property(stackSize, seed, fc.integer({ min: 0, max: 5 }), (n, s, cycle) => {
      const base = colorStack(n);
      const original = queryWide(base, cycle, cycle + 1);
      const shuffled = queryWide(base.shuffleStackCycle(s), cycle, cycle + 1);
      expect(shuffled).toHaveLength(original.length);
    }), { numRuns: RUNS });
  });

  it("onset times are preserved after shuffle", () => {
    fc.assert(fc.property(seed, (s) => {
      const base = stack(color("red blue"), color("green"));
      const original = queryWide(base, 0, 1);
      const shuffled = queryWide(base.shuffleStackCycle(s), 0, 1);
      const getOnsets = (haps: any[]) =>
        haps.map((h: any) => Number(h.whole?.begin ?? h.part.begin)).sort();
      expect(getOnsets(shuffled)).toEqual(getOnsets(original));
    }), { numRuns: RUNS });
  });
});

// ─── Composition invariants ─────────────────────────────────────────────────

describe("shuffleStack + index composition invariants", () => {
  it("shuffleStack.index() produces valid i/count", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const evs = queryAt(colorStack(n).shuffleStack(s).index(), t).map((h: any) => h.value);
      if (evs.length === 0) return;

      // All same count, equal to event count
      const counts = new Set(evs.map((v: any) => v.count));
      expect(counts.size).toBe(1);
      expect([...counts][0]).toBe(evs.length);

      // i values are a permutation of [0..count-1]
      const is = evs.map((v: any) => v.i).sort((a: number, b: number) => a - b);
      expect(is).toEqual(Array.from({ length: evs.length }, (_, i) => i));
    }), { numRuns: RUNS });
  });

  it("shuffleStackCycle.indexCycle() produces valid i/count", () => {
    fc.assert(fc.property(stackSize, seed, fc.integer({ min: 0, max: 5 }), (n, s, cycle) => {
      const evs = queryWide(colorStack(n).shuffleStackCycle(s).indexCycle(), cycle, cycle + 1)
        .map((h: any) => h.value);
      if (evs.length === 0) return;

      const counts = new Set(evs.map((v: any) => v.count));
      expect(counts.size).toBe(1);
      expect([...counts][0]).toBe(evs.length);

      const is = evs.map((v: any) => v.i).sort((a: number, b: number) => a - b);
      expect(is).toEqual(Array.from({ length: evs.length }, (_, i) => i));
    }), { numRuns: RUNS });
  });

  it("double shuffle is still a valid permutation", () => {
    fc.assert(fc.property(stackSize, seed, seed, queryTime, (n, s1, s2, t) => {
      const evs = queryAt(colorStack(n).shuffleStack(s1).shuffleStack(s2).index(), t)
        .map((h: any) => h.value);
      if (evs.length === 0) return;

      expect(new Set(evs.map((v: any) => v.color)).size).toBe(n);
      const is = evs.map((v: any) => v.i).sort((a: number, b: number) => a - b);
      expect(is).toEqual(Array.from({ length: evs.length }, (_, i) => i));
    }), { numRuns: RUNS });
  });

  it("shuffleStack after index doesn't crash (nonsensical but safe)", () => {
    fc.assert(fc.property(stackSize, seed, queryTime, (n, s, t) => {
      const evs = queryAt(colorStack(n).index().shuffleStack(s), t);
      expect(evs.length).toBeGreaterThan(0);
    }), { numRuns: RUNS });
  });
});
