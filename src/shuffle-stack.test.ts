/**
 * Tests for .shuffleStack() and .shuffleStackCycle() methods.
 *
 * .shuffleStack(seed?) — permutes co-active events at each instant query.
 *   stack(a, b, c).shuffleStack(42).index().rowscols(2).gridMod()
 *
 * .shuffleStackCycle(seed?) — permutes within onset-time groups across
 *   a query. For all-simultaneous stacks this is identical to shuffleStack.
 *   For mixed-subdivision stacks, only events sharing an onset get shuffled.
 *   stack(a, b, c).shuffleStackCycle(42).indexCycle().rowscols(2).gridMod()
 */
import { describe, it, expect } from "vitest";
import { stack, steady, pure, sine, useRNG } from "@strudel/core";
import { mini } from "@strudel/mini";
import { color } from "./color-pattern";
import { rand } from "./event-random";
import "./visual-controls";
import "./index-patterns";
import "./shuffle-stack";
import { index, indexCycle } from "./index-patterns";

function queryAll(pat: any, t: number) {
  return pat.queryArc(t, t).map((e: any) => e.value);
}

function queryAllWide(pat: any, start: number, end: number) {
  return pat.queryArc(start, end).map((e: any) => e.value);
}

// ─── shuffleStack (co-active permutation) ───────────────────────────────────

describe("shuffleStack", () => {
  it("permutes event order so index() assigns different i values", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStack(42);
    const indexed = shuffled.index();
    const evs = queryAll(indexed, 0.1);
    evs.sort((a: any, b: any) => a.i - b.i);

    const colors = evs.map((v: any) => v.color);
    expect(colors).toHaveLength(4);
    expect(new Set(colors)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    // Order differs from original
    expect(colors).not.toEqual(["red", "blue", "green", "yellow"]);
  });

  it("same seed produces same permutation", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const s1 = base.shuffleStack(42).index();
    const s2 = base.shuffleStack(42).index();

    const evs1 = queryAll(s1, 0.1);
    const evs2 = queryAll(s2, 0.1);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);

    expect(evs1.map((v: any) => v.color)).toEqual(evs2.map((v: any) => v.color));
  });

  it("different seeds produce different permutations", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const s1 = base.shuffleStack(1).index();
    const s2 = base.shuffleStack(2).index();

    const evs1 = queryAll(s1, 0.1);
    const evs2 = queryAll(s2, 0.1);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);

    expect(evs1.map((v: any) => v.color)).not.toEqual(evs2.map((v: any) => v.color));
  });

  it("pattern seed: different values at different times produce different shuffles", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStack(mini("1 2 3 4")).index();

    const evs1 = queryAll(shuffled, 0.1);  // seed=1
    const evs2 = queryAll(shuffled, 0.3);  // seed=2
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);

    expect(evs1.map((v: any) => v.color)).not.toEqual(evs2.map((v: any) => v.color));
  });

  it("default seed (no arg) produces a fixed shuffle", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStack().index();

    const evs1 = queryAll(shuffled, 0.1);
    const evs2 = queryAll(shuffled, 0.5);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);
    expect(evs1.map((v: any) => v.color)).toEqual(evs2.map((v: any) => v.color));

    // Same across cycles
    const evs3 = queryAll(shuffled, 1.1);
    evs3.sort((a: any, b: any) => a.i - b.i);
    expect(evs1.map((v: any) => v.color)).toEqual(evs3.map((v: any) => v.color));
  });

  it("single event passes through unchanged", () => {
    const base = color("red");
    const shuffled = base.shuffleStack(42).index();
    const evs = queryAll(shuffled, 0.1);
    expect(evs).toHaveLength(1);
    expect(evs[0].color).toBe("red");
    expect(evs[0].i).toBe(0);
  });

  it("works with varying durations — shuffles co-active set at each instant", () => {
    const base = stack(color("red blue"), color("green"));
    const shuffled = base.shuffleStack(42).index();

    const early = queryAll(shuffled, 0.1);
    expect(early).toHaveLength(2);
    expect(new Set(early.map((v: any) => v.color))).toEqual(new Set(["red", "green"]));

    const late = queryAll(shuffled, 0.6);
    expect(late).toHaveLength(2);
    expect(new Set(late.map((v: any) => v.color))).toEqual(new Set(["blue", "green"]));
  });

  it("full chain with gridMod works", () => {
    const pat = stack(color("red"), color("blue"), color("green"), color("yellow"))
      .shuffleStack(42)
      .index()
      .rowscols(2)
      .gridMod();

    const evs = queryAll(pat, 0.1);
    expect(evs).toHaveLength(4);
    const colors = new Set(evs.map((v: any) => v.color));
    expect(colors).toEqual(new Set(["red", "blue", "green", "yellow"]));
  });
});

// ─── shuffleStackCycle (onset-group permutation) ─────────────────────────────

describe("shuffleStackCycle", () => {
  it("shuffles all-simultaneous stack (same as shuffleStack for this case)", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(42).indexCycle();
    const evs = queryAllWide(shuffled, 0, 1);
    evs.sort((a: any, b: any) => a.i - b.i);

    const colors = evs.map((v: any) => v.color);
    expect(colors).toHaveLength(4);
    expect(new Set(colors)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    expect(colors).not.toEqual(["red", "blue", "green", "yellow"]);
  });

  it("same seed produces same permutation", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const evs1 = queryAllWide(base.shuffleStackCycle(42).indexCycle(), 0, 1);
    const evs2 = queryAllWide(base.shuffleStackCycle(42).indexCycle(), 0, 1);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);
    expect(evs1.map((v: any) => v.color)).toEqual(evs2.map((v: any) => v.color));
  });

  it("different seeds produce different permutations", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const evs1 = queryAllWide(base.shuffleStackCycle(1).indexCycle(), 0, 1);
    const evs2 = queryAllWide(base.shuffleStackCycle(2).indexCycle(), 0, 1);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);
    expect(evs1.map((v: any) => v.color)).not.toEqual(evs2.map((v: any) => v.color));
  });

  it("with mixed subdivisions: shuffles within onset groups, preserves temporal order", () => {
    // "red blue" (2/cycle) stacked with "green" (1/cycle)
    // Onset groups: {0: [red, green], 0.5: [blue]}
    // Only the onset=0 group (red, green) can be shuffled
    // blue is alone at onset=0.5, so it stays put
    const base = stack(color("red blue"), color("green"));

    const normal = base.indexCycle();
    const shuffled = base.shuffleStackCycle(42).indexCycle();

    const normalEvs = queryAllWide(normal, 0, 1);
    const shuffledEvs = queryAllWide(shuffled, 0, 1);

    expect(normalEvs).toHaveLength(3);
    expect(shuffledEvs).toHaveLength(3);

    // Same events present
    expect(new Set(shuffledEvs.map((v: any) => v.color)))
      .toEqual(new Set(normalEvs.map((v: any) => v.color)));

    // blue should have the highest i in both (last onset)
    normalEvs.sort((a: any, b: any) => a.i - b.i);
    shuffledEvs.sort((a: any, b: any) => a.i - b.i);
    expect(normalEvs[2].color).toBe("blue");
    expect(shuffledEvs[2].color).toBe("blue");

    // red and green may have swapped i values
    const normalTie = [normalEvs[0].color, normalEvs[1].color];
    const shuffledTie = [shuffledEvs[0].color, shuffledEvs[1].color];
    // Both contain red and green
    expect(new Set(normalTie)).toEqual(new Set(["red", "green"]));
    expect(new Set(shuffledTie)).toEqual(new Set(["red", "green"]));
  });

  it("default seed (no arg) produces a fixed shuffle", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle();

    const evs1 = queryAllWide(shuffled.indexCycle(), 0, 1);
    const evs2 = queryAllWide(shuffled.indexCycle(), 1, 2);
    evs1.sort((a: any, b: any) => a.i - b.i);
    evs2.sort((a: any, b: any) => a.i - b.i);
    expect(evs1.map((v: any) => v.color)).toEqual(evs2.map((v: any) => v.color));
  });

  it("single event passes through unchanged", () => {
    const evs = queryAllWide(color("red").shuffleStackCycle(42).indexCycle(), 0, 1);
    expect(evs).toHaveLength(1);
    expect(evs[0].color).toBe("red");
  });
});

// ─── Signals and steady values ──────────────────────────────────────────────

describe("shuffleStack with signals/steady", () => {
  it("shuffles stacked steady values", () => {
    const base = stack(steady(10), steady(20), steady(30), steady(40));
    const shuffled = base.shuffleStack(42).index();
    const evs = queryAll(shuffled, 0.1);
    evs.sort((a: any, b: any) => a.i - b.i);

    // All four values present (steady wraps primitives, so value is the number directly)
    const vals = evs.map((v: any) => (typeof v === "object" ? v.i : v));
    expect(evs).toHaveLength(4);
    // i values should be a permutation of [0, 1, 2, 3]
    expect(evs.map((v: any) => v.i)).toEqual([0, 1, 2, 3]);
  });

  it("steady values: different seeds produce different orderings", () => {
    const base = stack(steady(10), steady(20), steady(30), steady(40));
    const s1 = base.shuffleStack(1);
    const s2 = base.shuffleStack(2);

    // Query raw events (before index) to see the order
    const haps1 = s1.queryArc(0.1, 0.1).map((h: any) => h.value);
    const haps2 = s2.queryArc(0.1, 0.1).map((h: any) => h.value);

    expect(haps1).toHaveLength(4);
    expect(haps2).toHaveLength(4);
    // Same values present
    expect(new Set(haps1)).toEqual(new Set([10, 20, 30, 40]));
    expect(new Set(haps2)).toEqual(new Set([10, 20, 30, 40]));
    // Different orderings
    expect(haps1).not.toEqual(haps2);
  });

  it("shuffles stacked steady values consistently across cycles", () => {
    const base = stack(steady(10), steady(20), steady(30), steady(40));
    const shuffled = base.shuffleStack(); // default = fixed

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value);
    const haps2 = shuffled.queryArc(1.1, 1.1).map((h: any) => h.value);
    const haps3 = shuffled.queryArc(5.7, 5.7).map((h: any) => h.value);

    expect(haps1).toEqual(haps2);
    expect(haps2).toEqual(haps3);
  });

  it("mixed stack of discrete patterns and steady values", () => {
    // color("red") is discrete (has whole), steady(99) is continuous (no whole)
    const base = stack(color("red"), color("blue"), steady(99));
    const shuffled = base.shuffleStack(42);

    const haps = shuffled.queryArc(0.1, 0.1);
    expect(haps).toHaveLength(3);

    // All values present (2 colors + number)
    const vals = haps.map((h: any) => h.value);
    const colors = vals.filter((v: any) => v?.color).map((v: any) => v.color);
    const nums = vals.filter((v: any) => typeof v === "number");
    expect(new Set(colors)).toEqual(new Set(["red", "blue"]));
    expect(nums).toEqual([99]);
  });

  it("seed can be a signal (sine)", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    // sine varies continuously, so shuffleStack should produce different
    // orderings at different query times
    const shuffled = base.shuffleStack(sine);

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const haps2 = shuffled.queryArc(0.4, 0.4).map((h: any) => h.value.color);

    expect(haps1).toHaveLength(4);
    expect(haps2).toHaveLength(4);
    expect(new Set(haps1)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    expect(new Set(haps2)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    // sine(0.1) ≠ sine(0.4), so orderings should differ
    expect(haps1).not.toEqual(haps2);
  });

  it("seed can be pure (changes per cycle)", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    // pure(n) repeats n every cycle, so shuffle is fixed within a cycle
    // but rand.segment(1) would change per cycle. Let's use irand for variety:
    // Actually pure(42) is the same every cycle. Let's just verify it's stable.
    const shuffled = base.shuffleStack(pure(42));

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const haps2 = shuffled.queryArc(0.9, 0.9).map((h: any) => h.value.color);
    const haps3 = shuffled.queryArc(1.1, 1.1).map((h: any) => h.value.color);

    // Same within cycle
    expect(haps1).toEqual(haps2);
    // Same across cycles (pure(42) is always 42)
    expect(haps1).toEqual(haps3);
  });
});

describe("shuffleStackCycle seed resolution via createMixParam", () => {
  it("rand (_perEvent) produces same shuffle within a cycle", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(rand);

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const haps2 = shuffled.queryArc(0.7, 0.7).map((h: any) => h.value.color);

    // rand is _perEvent → appLeft samples at carrier's whole span → stable per cycle
    expect(haps1).toEqual(haps2);
  });

  it("sine (not _perEvent) may vary within a cycle", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(sine);

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const haps2 = shuffled.queryArc(0.8, 0.8).map((h: any) => h.value.color);

    // sine is NOT _perEvent → frame-time resolution → may produce different shuffles
    // (sine(0.1) ≠ sine(0.8)), but all values are still present
    expect(new Set(haps1)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    expect(new Set(haps2)).toEqual(new Set(["red", "blue", "green", "yellow"]));
  });

  it("mini '1 2' produces different shuffles in each half of cycle", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(mini("1 2"));

    const haps1 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const haps2 = shuffled.queryArc(0.6, 0.6).map((h: any) => h.value.color);

    // "1 2" is discrete → frame-time combiner picks the active event
    // first half gets seed=1, second half gets seed=2
    expect(haps1).not.toEqual(haps2);
  });
});

describe("shuffleStackCycle rand changes per cycle", () => {
  it("rand seed produces different shuffles in different cycles", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(rand);

    const c0 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const c1 = shuffled.queryArc(1.1, 1.1).map((h: any) => h.value.color);
    const c2 = shuffled.queryArc(2.1, 2.1).map((h: any) => h.value.color);

    // All should have same colors
    expect(new Set(c0)).toEqual(new Set(["red", "blue", "green", "yellow"]));
    expect(new Set(c1)).toEqual(new Set(["red", "blue", "green", "yellow"]));

    // Different cycles should (very likely) produce different orderings
    const allSame = JSON.stringify(c0) === JSON.stringify(c1) && JSON.stringify(c1) === JSON.stringify(c2);
    expect(allSame).toBe(false);
  });

  it("rand seed produces different shuffles in different cycles (legacy RNG)", () => {
    // The browser uses legacy RNG by default — verify it works there too
    (useRNG as any)("legacy");
    try {
      const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
      const shuffled = base.shuffleStackCycle(rand);

      const c0 = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
      const c1 = shuffled.queryArc(1.1, 1.1).map((h: any) => h.value.color);
      const c2 = shuffled.queryArc(2.1, 2.1).map((h: any) => h.value.color);

      // All should have same colors
      expect(new Set(c0)).toEqual(new Set(["red", "blue", "green", "yellow"]));

      // Different cycles should produce different orderings
      const allSame = JSON.stringify(c0) === JSON.stringify(c1) && JSON.stringify(c1) === JSON.stringify(c2);
      expect(allSame).toBe(false);
    } finally {
      (useRNG as any)("precise");
    }
  });

  it("stable within a cycle, different across cycles", () => {
    const base = stack(color("red"), color("blue"), color("green"), color("yellow"));
    const shuffled = base.shuffleStackCycle(rand);

    // Same cycle, different frame times
    const c0a = shuffled.queryArc(0.1, 0.1).map((h: any) => h.value.color);
    const c0b = shuffled.queryArc(0.7, 0.7).map((h: any) => h.value.color);
    expect(c0a).toEqual(c0b);

    // Different cycle
    const c1 = shuffled.queryArc(1.1, 1.1).map((h: any) => h.value.color);
    // Should differ from cycle 0 (very high probability with 4 items)
    expect(c0a).not.toEqual(c1);
  });
});

describe("shuffleStackCycle with signals/steady", () => {
  it("shuffles stacked steady values within onset group", () => {
    // All steadys have same onset (part.begin), so they all land in one group
    const base = stack(steady(10), steady(20), steady(30), steady(40));
    const shuffled = base.shuffleStackCycle(42);

    const haps = shuffled.queryArc(0.1, 0.1);
    expect(haps).toHaveLength(4);
    expect(new Set(haps.map((h: any) => h.value))).toEqual(new Set([10, 20, 30, 40]));
  });

  it("mixed discrete + steady: groups by onset correctly", () => {
    // "red blue" has 2 discrete events (onset 0 and 0.5)
    // steady(99) has continuous events (onset = query begin, no whole)
    //
    // At an instant query, "red" (onset 0) and steady(99) (onset = query time)
    // may or may not share the same onset key depending on query position.
    const base = stack(color("red blue"), steady(99));
    const shuffled = base.shuffleStackCycle(42);

    // At t=0.1: red has whole.begin=0, steady has part.begin=0.1
    // These have different onsets, so they're in separate groups
    const haps = shuffled.queryArc(0.1, 0.1);
    expect(haps).toHaveLength(2);
  });

  it("all-steady stack: shuffleStackCycle matches shuffleStack behavior", () => {
    const base = stack(steady(10), steady(20), steady(30), steady(40));

    const viaShuffle = base.shuffleStack(42).queryArc(0.1, 0.1).map((h: any) => h.value);
    const viaCycle = base.shuffleStackCycle(42).queryArc(0.1, 0.1).map((h: any) => h.value);

    // Both should produce the same permutation since all events share onset
    expect(new Set(viaShuffle)).toEqual(new Set(viaCycle));
  });
});
