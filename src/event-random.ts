/**
 * Picodevil per-event random functions.
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
  degradeBy as _degradeBy,
  degrade as _degrade,
  undegradeBy as _undegradeBy,
  undegrade as _undegrade,
  sometimesBy as _sometimesBy,
  sometimes as _sometimes,
  someCyclesBy as _someCyclesBy,
  someCycles as _someCycles,
  often as _often,
  rarely as _rarely,
  almostNever as _almostNever,
  almostAlways as _almostAlways,
  always as _always,
  never as _never,
} from "@strudel/core";

// Structural Strudel combinators that reshape patterns rather than transforming
// values in parameter space. _perEvent must NOT propagate through these — doing
// so would freeze animated signals like `sine.late(rand.segment(1))` at onset.
const STRUCTURAL_METHODS = new Set([
  'fmap', 'innerJoin', 'outerJoin', 'appLeft', 'appRight', 'appBoth', 'bind', 'query',
]);

function perEvent(pat: any): any {
  return new Proxy(pat, {
    get(target, prop) {
      if (prop === "_perEvent") return true;
      const val = (target as any)[prop];
      if (typeof val !== "function") return val;
      return function (...args: any[]) {
        const result = val.apply(target, args);
        const isPattern = result && typeof result === "object" && typeof result.query === "function";
        if (isPattern && !STRUCTURAL_METHODS.has(prop as string))
          return perEvent(result);
        return result;
      };
    },
  });
}

/**
 * Random float 0–1. Stable for the duration of each hap (per-event), so a video
 * or color keeps the same random value for its whole event rather than flickering.
 * @example
 * $: s("clip.mp4").alpha(rand)
 * @example
 * $: s("clip.mp4").x(rand)
 */
export const rand = perEvent(_rand);

/**
 * Random float −1–1. Stable for the duration of each hap (per-event).
 * @example
 * $: s("clip.mp4").x(rand2)
 */
export const rand2 = perEvent(_rand2);

/**
 * Random integer 0 to n−1. Stable for the duration of each hap (per-event).
 * @param n: upper bound (exclusive)
 * @example
 * $: s("clip.mp4").speed(irand(4))
 */
export const irand = (n: any) => perEvent(_irand(n));

/**
 * Binary random — 0 or 1 with 50/50 probability. Stable per hap.
 * @example
 * $: s("clip.mp4").alpha(brand)
 */
export const brand = perEvent(_brand);

/**
 * Binary random — 0 or 1 with probability p. Stable per hap.
 * @param p: probability of 1 (0–1)
 * @example
 * $: s("clip.mp4").alpha(brandBy(0.25))
 */
export const brandBy = (p: any) => perEvent(_brandBy(p));

/**
 * Randomly pick one value from the provided list each hap. Stable for the
 * duration of each hap (per-event).
 * @example
 * $: s("clip.mp4").speed(choose(0.5, 1, 2))
 * @example
 * $: s("clip.mp4").blend(choose("screen", "multiply", "overlay"))
 */
export const choose = (...xs: any[]) => perEvent(_choose(...xs));

/**
 * Like `choose()` but uses a custom 0–1 pattern as the index source.
 * Stable per hap.
 * @param pat: pattern producing values 0–1
 * @param xs: list of values to choose from
 */
export const chooseWith = (pat: any, xs: any[]) => perEvent(_chooseWith(pat, xs));

/**
 * Weighted random pick — each argument is a `[value, weight]` pair. Stable
 * for the duration of each hap.
 * @example
 * $: s("clip.mp4").speed(wchoose([0.5, 1], [1, 3], [2, 1]))
 */
export const wchoose = (...pairs: any[]) => perEvent(_wchoose(...pairs));

// ─── Cycle-stable scramble ────────────────────────────────────────────────────

/**
 * Divide a pattern into `n` slices and shuffle them each cycle. Uses
 * cycle-stable randomness so the order is constant within a cycle (changes
 * once per cycle, not per event). Works as a standalone function or chained
 * as a method.
 * @param n: number of slices to cut the pattern into
 * @example
 * $: s("clip.mp4").scramble(4)
 * @example
 * $: scramble(4, color("red blue green yellow"))
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

// ─── Re-exports with JSDoc (already work correctly per-hap via appLeft) ──────

/**
 * Randomly remove events each cycle with probability `p` (0–1).
 * @param p: probability of removal per event (0 = keep all, 1 = remove all)
 * @example
 * $: s("clip.mp4").degradeBy(0.3)
 */
export const degradeBy = _degradeBy;

/**
 * Randomly remove ~50% of events each cycle.
 * @example
 * $: s("clip.mp4 other.mp4").degrade()
 */
export const degrade = _degrade;

/**
 * Keep events with probability `p` (inverse of degradeBy).
 * @param p: probability of keeping an event
 */
export const undegradeBy = _undegradeBy;

/** Keep ~50% of events (inverse of degrade). */
export const undegrade = _undegrade;

/**
 * Apply `fn` to the pattern with probability `p` each event.
 * @param p: probability 0–1
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").sometimesBy(0.3, p => p.speed(2))
 */
export const sometimesBy = _sometimesBy;

/**
 * Apply `fn` to ~50% of events.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").sometimes(p => p.speed(2))
 */
export const sometimes = _sometimes;

/**
 * Apply `fn` to some whole cycles with probability `p`.
 * @param p: probability 0–1
 * @param fn: transform to apply
 */
export const someCyclesBy = _someCyclesBy;

/**
 * Apply `fn` to ~50% of whole cycles.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").someCycles(p => p.speed(2))
 */
export const someCycles = _someCycles;

/**
 * Apply `fn` to ~75% of events.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").often(p => p.alpha(0.5))
 */
export const often = _often;

/**
 * Apply `fn` to ~25% of events.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").rarely(p => p.speed(2))
 */
export const rarely = _rarely;

/**
 * Apply `fn` to ~10% of events.
 * @param fn: transform to apply
 */
export const almostNever = _almostNever;

/**
 * Apply `fn` to ~90% of events.
 * @param fn: transform to apply
 */
export const almostAlways = _almostAlways;

/**
 * Apply `fn` to every event (identity — useful for uniform API).
 * @param fn: transform to apply
 */
export const always = _always;

/**
 * Apply `fn` to no events (identity — useful for uniform API).
 * @param fn: transform to apply
 */
export const never = _never;
