/**
 * Uzuvid per-event random functions.
 *
 * These wrap Strudel's random signals and tag them with `_perEvent: true`.
 * When used as a control value (e.g. `.alpha(rand)`), createMixParam detects
 * the tag and queries the signal at each hap's onset time rather than the
 * current frame time — giving a stable value for the hap's full duration
 * instead of flickering every frame.
 *
 * Smooth continuous signals (sine, perlin, etc.) are NOT tagged and continue
 * to evaluate per-frame for smooth animation.
 */

import { Pattern, Fraction } from "@strudel/core";
import {
  rand as _rand,
  rand2 as _rand2,
  irand as _irand,
  brand as _brand,
  brandBy as _brandBy,
  choose as _choose,
  chooseWith as _chooseWith,
  wchoose as _wchoose,
  randrun,
  degradeBy,
  degrade,
  undegradeBy,
  undegrade,
  sometimesBy,
  sometimes,
  someCyclesBy,
  someCycles,
  often,
  rarely,
  almostNever,
  almostAlways,
  always,
  never,
} from "@strudel/core";

function perEvent(pat: any): any {
  return new Proxy(pat, {
    get(target, prop) {
      if (prop === "_perEvent") return true;
      const val = (target as any)[prop];
      if (typeof val !== "function") return val;
      return function (...args: any[]) {
        const result = val.apply(target, args);
        if (result && typeof result === "object" && typeof result.query === "function")
          return perEvent(result);
        return result;
      };
    },
  });
}

/** Random float 0–1. Stable for the duration of each hap (per-event). */
export const rand = perEvent(_rand);

/** Random float −1–1. Stable for the duration of each hap (per-event). */
export const rand2 = perEvent(_rand2);

/** Random integer 0 to n−1. Stable for the duration of each hap (per-event). */
export const irand = (n: any) => perEvent(_irand(n));

/** Binary random 0 or 1 (50/50). Stable per hap. */
export const brand = perEvent(_brand);

/** Binary random with probability p. Stable per hap. */
export const brandBy = (p: any) => perEvent(_brandBy(p));

/** Randomly pick one value from the list. Stable for the duration of each hap. */
export const choose = (...xs: any[]) => perEvent(_choose(...xs));

/** Like choose() but uses a custom 0–1 pattern for indexing. Stable per hap. */
export const chooseWith = (pat: any, xs: any[]) => perEvent(_chooseWith(pat, xs));

/** Weighted random pick. Stable for the duration of each hap. */
export const wchoose = (...pairs: any[]) => perEvent(_wchoose(...pairs));

// ─── Cycle-stable scramble ────────────────────────────────────────────────────

/**
 * Like Strudel's scramble, but uses cycle-stable randomness (randrun) so the
 * arrangement is constant within a cycle rather than changing per segment.
 * The order changes once per cycle, not per event.
 */
export const scramble = (n: number, pat?: any): any => {
  const impl = (p: any): any => {
    const slices = Array.from({ length: n }, (_, i) =>
      p.zoom(Fraction(i).div(n), Fraction(i + 1).div(n))
    );
    return randrun(n)
      .fmap((i: number) => slices[i].repeatCycles(n)._fast(n))
      .innerJoin();
  };
  return pat !== undefined ? impl(pat) : impl;
};

// Register scramble on Pattern.prototype
(Pattern.prototype as any).scramble = function (n: number) {
  return scramble(n, this);
};

// ─── Re-exports (already work correctly per-hap via appLeft) ─────────────────

export {
  degradeBy,
  degrade,
  undegradeBy,
  undegrade,
  sometimesBy,
  sometimes,
  someCyclesBy,
  someCycles,
  often,
  rarely,
  almostNever,
  almostAlways,
  always,
  never,
};
