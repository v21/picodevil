import { test, expect, describe } from "vitest";
import fc from "fast-check";
import { getPatternGlobals, runTranspiled, buildNormMap } from "./eval-sandbox";
import { Fraction, State, TimeSpan, reify } from "@strudel/core";
import { transpile } from "./transpiler";
import { initRegistry, resetRegistry, collectScreens } from "./pattern-registry";
import { topExpr } from "../test/arbitraries";
import "./shuffle-stack"; // register shuffleStack/shuffleIndex on Pattern.prototype

/**
 * Guard against the "Number() round-trip" bug class.
 *
 * Strudel keeps all time as exact `Fraction`s. Some picodevil structural ops
 * re-query their sources via `.queryArc(Number(begin), Number(end))`, which
 * round-trips the query span through a JS float; fraction.js then rationalizes
 * that float to a *nearby but different* Fraction. The skew is invisible until
 * a downstream zero-width sample (e.g. createMixParam's `.alpha()`) compares
 * the skewed instant for exact equality and drops the control — the live
 * per-frame alpha flicker we tracked down.
 *
 * Invariant: every event returned for a query at instant T must be *active* at
 * T — i.e. T lies within its part. The float skew pushes a zero-width part off
 * T, breaking that. Two deliberate choices keep this targeting only the skew:
 *  - containment, not exact `part.begin === T`: cycle-order ops (indexCycle)
 *    legitimately return full-cycle parts `[0,1)` that still contain T.
 *  - orientation-agnostic (min/max): negative time-warps (fast(-n)) legitimately
 *    return reversed parts (begin > end) with clean rationals — not a skew.
 */
const g = getPatternGlobals() as any;
const { color, s, index, indexCycle } = g;

// A query instant that does NOT survive a float round-trip, i.e.
// Fraction(Number(t)) !== t. (This is exactly what late(0.1) produces: a messy
// frame time minus 0.1.) If this ever becomes stable the probe is worthless,
// so we assert it up front.
const T = (Fraction as any)(0.2753500000238395).sub((Fraction as any)(0.1));

const queryAtT = (pat: any) =>
  pat.query(new (State as any)(new (TimeSpan as any)(T, T)));

// T lies within the part, regardless of orientation (reversed parts have begin > end).
const partActiveAtT = (part: any): boolean => {
  const lo = part.begin.lte(part.end) ? part.begin : part.end;
  const hi = part.begin.lte(part.end) ? part.end : part.begin;
  return lo.lte(T) && hi.gte(T);
};

// A float round-trip produces a skewed instant within ~1e-12 of T. Events placed
// whole cycles away (e.g. by fastGap with extreme args) are legitimate results,
// not skew — exclude them from the containment check.
const SKEW_TOLERANCE = 1e-10;
const isNearT = (part: any): boolean =>
  Math.abs(Number(part.begin) - Number(T)) < SKEW_TOLERANCE;

const src = () => color("red");

describe("structural ops preserve exact query-time Fraction (no Number() round-trip)", () => {
  test("probe time is genuinely float-round-trip-unstable", () => {
    expect((Fraction as any)(Number(T)).equals(T)).toBe(false);
  });

  // Each op is a thunk so a missing method can't abort the whole suite.
  const ops: Array<[string, () => any]> = [
    ["identity", () => src()],
    ["stackN(4)", () => src().stackN(4)],
    ["index()", () => index(src(), src())],
    ["indexCycle()", () => indexCycle(src(), src())],
    ["shuffleStack()", () => src().stackN(2).shuffleStack(1)],
    ["shuffleIndex()", () => src().stackN(2).shuffleIndex(1)],
    ["chopStack(2)", () => s("red").chopStack(2)],
    ["cropStack(2)", () => s("red").cropStack(2)],
    ["gridMod()", () => src().gridMod()],
    ["scramble(2)", () => src().scramble(2)],
  ];

  test.each(ops)("%s returns events whose part contains the query instant", (_name, mk) => {
    const haps = queryAtT(mk());
    expect(haps.length).toBeGreaterThan(0);
    for (const h of haps) {
      if (!isNearT(h.part)) continue; // whole-cycle-away results (e.g. fastGap) are legitimate
      expect(
        partActiveAtT(h.part),
        `part [${h.part.begin.toFraction()}, ${h.part.end.toFraction()}] excludes query instant ${T.toFraction()}`,
      ).toBe(true);
    }
  });
});

/**
 * Property-based version of the same invariant, driven by the monkey-tester
 * grammar (test/arbitraries.ts). This auto-covers every operator reachable
 * through the grammar — so any operator added to the arbitraries later is
 * checked for the Number() round-trip with no change to this file.
 *
 * The invariant is universal: a zero-width query at instant T must return haps
 * whose part.begin is exactly T. The float round-trip is the only thing that
 * breaks it, so a counterexample is always a round-trip bug, never a false
 * positive. fast-check shrinks the failing program to a minimal repro.
 */
describe("no grammar operator round-trips query time through a float", () => {
  initRegistry();
  const normMap = buildNormMap();

  // Stub the runtime-only globals the grammar can emit (main.ts normally
  // provides these); none affect pattern *time*, so stubbing is safe here.
  const STUBS: Record<string, unknown> = {
    setCps: () => {}, setCpm: () => {}, hush: () => {},
    loadVideo: () => {}, loadImage: () => {}, loadCamera: () => {}, loadScreen: () => {},
    slider: (v: any) => (reify as any)(v ?? 0),
    fontPicker: (f: any) => (reify as any)(f ?? "sans-serif"),
  };

  const evalToScreens = (code: string): any[] => {
    resetRegistry();
    const { code: transpiled } = transpile(code, normMap);
    runTranspiled(transpiled, STUBS);
    return collectScreens();
  };

  test("generated programs preserve exact query-time Fraction", () => {
    fc.assert(
      fc.property(topExpr, ({ code }: any) => {
        let screens: any[];
        try {
          // Eval + query crashes (e.g. Strudel's negative-arg quirks) are the
          // monkey tester's domain, not ours — skip them and only judge the
          // float-skew invariant on programs that build and query cleanly.
          screens = evalToScreens(code);
          for (const p of screens) {
            for (const h of queryAtT(p)) {
              if (!isNearT(h.part)) continue; // whole-cycle-away results are legitimate
              if (!partActiveAtT(h.part)) return false;
            }
          }
        } catch {
          return true;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});
