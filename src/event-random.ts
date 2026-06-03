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

import { Pattern, Fraction, Hap, reify, stack, register } from "@strudel/core";
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

// ─── Seeded structural randomness (honour per-tile _randSeed) ────────────────
//
// Strudel's degradeBy/sometimes/… decide per event using `rand`, which is keyed
// only on (time, controls.randSeed). Co-active (stacked) events share an onset
// time and seed, so they all get the SAME coin flip — the transform applies
// all-or-none across the stack. picodevil's stacking ops (shuffleIndex, index,
// chopStack, grid…) stamp a unique `_randSeed` on each tile's value to
// decorrelate per-event controls (see create-mix-param.ts). The functions below
// re-implement Strudel's degrade/sometimes family so the decision is queried
// per source hap with that hap's `_randSeed` injected — decorrelating the
// transform per tile. Events without a `_randSeed` fall back to the outer state
// seed, i.e. exactly vanilla Strudel behaviour (one shared time-based flip for
// co-active events).
//
// These call register(), which (re)installs the method on Pattern.prototype AND
// returns the curried/patternified standalone — so the chained form
// (`.sometimes(...)`), the standalone form, and the sandbox global all share the
// seeded implementation.

const SeededPattern = Pattern as any;

/**
 * Like Strudel's `degradeByWith`, but the decision pattern is queried per source
 * hap with that hap's `_randSeed` pushed into the controls. Faithful to vanilla
 * `appLeft` semantics otherwise: sample the decision over the hap's whole-or-part
 * span, keep the hap when the decision value is > x, and preserve its whole.
 */
function degradeByWithSeeded(decisionPat: any, x: number, pat: any): any {
  const gate = decisionPat.filterValues((v: number) => v > x);
  return new SeededPattern((state: any) => {
    const out: any[] = [];
    for (const hap of pat.query(state)) {
      const hapSeed = (hap.value as any)?._randSeed;
      const seeded = hapSeed !== undefined ? state.setControls({ randSeed: hapSeed }) : state;
      const decHaps = gate.query(seeded.setSpan(hap.wholeOrPart()));
      for (const dh of decHaps) {
        const part = hap.part.intersection(dh.part);
        if (part) out.push(new Hap(hap.whole, part, hap.value, hap.context));
      }
    }
    return out;
  });
}

// Decision sources. `*Cyc` variants quantise to one draw per cycle (segment(1))
// for the someCycles family; the others sample per event onset.
const _decDegrade = _rand;
const _decUndegrade = _rand.fmap((r: number) => 1 - r);
const _decDegradeCyc = _rand.segment(1);
const _decUndegradeCyc = _rand.segment(1).fmap((r: number) => 1 - r);

const _degradeBySeeded = (x: number, pat: any) => degradeByWithSeeded(_decDegrade, x, pat);
const _undegradeBySeeded = (x: number, pat: any) => degradeByWithSeeded(_decUndegrade, x, pat);

// ── Stack (draw) order preservation ──
//
// Stack order matters: picodevil paints co-active events in query order, so the
// LAST event in a stack is drawn on top (e.g. a `multiply` scanline overlay
// stacked over content). sometimes/someCyclesBy are stack(unchanged, transformed)
// under the hood, which concatenates the two partitions and therefore *reorders*
// co-active events whenever some are transformed and others aren't — silently
// changing who's on top. We want to preserve stack order wherever we can: so we
// tag each source hap with its original query-order index before the split, then
// re-sort by that tag afterwards. (degradeBy and the other filtering ops already
// preserve order; only the partition family needs this.)
//
// Note: the tag is stamped on the value, so it survives `func` (controls merge
// into the value) and is stripped again on the way out.
function _withStackOrder(pat: any): any {
  return new SeededPattern((state: any) =>
    pat.query(state).map((hap: any, i: number) =>
      hap.withValue((v: any) => ({ ...(Object(v) === v ? v : {}), _stackOrder: i })),
    ),
  );
}
function _restoreStackOrder(pat: any): any {
  return new SeededPattern((state: any) => {
    const haps = pat.query(state).slice();
    // Array.sort is stable, so ties (e.g. one hap that func split into several)
    // keep their generated order within the original layer's slot.
    haps.sort((a: any, b: any) => (a.value?._stackOrder ?? 0) - (b.value?._stackOrder ?? 0));
    return haps.map((hap: any) =>
      hap.withValue((v: any) => {
        if (Object(v) !== v) return v;
        const { _stackOrder, ...rest } = v;
        return rest;
      }),
    );
  });
}

// sometimesBy(p) = stack(keep-when-rand>p, apply-fn-when-rand<p). Both halves use
// the same per-hap seed, so each tile lands in exactly one half — a consistent,
// non-overlapping partition. reify(prob)…innerJoin lets prob itself be a pattern.
// Wrapped in _withStackOrder/_restoreStackOrder so the partition can't reorder
// co-active layers (see note above).
function _someBy(prob: any, func: any, pat: any): any {
  const tagged = _withStackOrder(pat);
  return _restoreStackOrder(
    reify(prob)
      .fmap((x: number) => stack(_degradeBySeeded(x, tagged), func(_undegradeBySeeded(1 - x, tagged))))
      .innerJoin(),
  );
}
function _someCyclesBy(prob: any, func: any, pat: any): any {
  const tagged = _withStackOrder(pat);
  return _restoreStackOrder(
    reify(prob)
      .fmap((x: number) =>
        stack(
          degradeByWithSeeded(_decDegradeCyc, x, tagged),
          func(degradeByWithSeeded(_decUndegradeCyc, 1 - x, tagged)),
        ),
      )
      .innerJoin(),
  );
}

/**
 * Randomly remove events each cycle with probability `p` (0–1). Decorrelated
 * per tile when the source carries a `_randSeed` (shuffleIndex/index/grid/…).
 * @param p: probability of removal per event (0 = keep all, 1 = remove all)
 * @example
 * $: s("clip.mp4").degradeBy(0.3)
 */
export const degradeBy = register("degradeBy", (x: number, pat: any) => _degradeBySeeded(x, pat));

/**
 * Randomly remove ~50% of events each cycle.
 * @example
 * $: s("clip.mp4 other.mp4").degrade()
 */
export const degrade = register("degrade", (pat: any) => _degradeBySeeded(0.5, pat));

/**
 * Keep events with probability `p` (inverse of degradeBy).
 * @param p: probability of keeping an event
 */
export const undegradeBy = register("undegradeBy", (x: number, pat: any) => _undegradeBySeeded(x, pat));

/** Keep ~50% of events (inverse of degrade). */
export const undegrade = register("undegrade", (pat: any) => _undegradeBySeeded(0.5, pat));

/**
 * Apply `fn` to the pattern with probability `p` each event. Decorrelated per
 * tile when the source carries a `_randSeed` (shuffleIndex/index/grid/…), so a
 * stack of videos each gets an independent coin flip.
 * @param p: probability 0–1
 * @param fn: transform to apply
 * @example
 * $: s("a,b,c").shuffleIndex(rand.segment(1)).sometimesBy(0.3, p => p.speed(-1))
 */
export const sometimesBy = register("sometimesBy", (patx: any, func: any, pat: any) => _someBy(patx, func, pat));

/**
 * Apply `fn` to ~50% of events (decorrelated per tile, see sometimesBy).
 * @param fn: transform to apply
 * @example
 * $: s("a,b,c").shuffleIndex(rand.segment(1)).sometimes(p => p.speed(-1))
 */
export const sometimes = register("sometimes", (func: any, pat: any) => _someBy(0.5, func, pat));

/**
 * Apply `fn` to some whole cycles with probability `p` (per-tile decorrelated;
 * one draw per cycle).
 * @param p: probability 0–1
 * @param fn: transform to apply
 */
export const someCyclesBy = register("someCyclesBy", (patx: any, func: any, pat: any) => _someCyclesBy(patx, func, pat));

/**
 * Apply `fn` to ~50% of whole cycles.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").someCycles(p => p.speed(2))
 */
export const someCycles = register("someCycles", (func: any, pat: any) => _someCyclesBy(0.5, func, pat));

/**
 * Apply `fn` to ~75% of events.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").often(p => p.alpha(0.5))
 */
export const often = register("often", (func: any, pat: any) => _someBy(0.75, func, pat));

/**
 * Apply `fn` to ~25% of events.
 * @param fn: transform to apply
 * @example
 * $: s("clip.mp4").rarely(p => p.speed(2))
 */
export const rarely = register("rarely", (func: any, pat: any) => _someBy(0.25, func, pat));

/**
 * Apply `fn` to ~10% of events.
 * @param fn: transform to apply
 */
export const almostNever = register("almostNever", (func: any, pat: any) => _someBy(0.1, func, pat));

/**
 * Apply `fn` to ~90% of events.
 * @param fn: transform to apply
 */
export const almostAlways = register("almostAlways", (func: any, pat: any) => _someBy(0.9, func, pat));

/**
 * Apply `fn` to every event (identity — useful for uniform API).
 * @param fn: transform to apply
 */
export const always = register("always", (func: any, pat: any) => _someBy(1, func, pat));

/**
 * Apply `fn` to no events (identity — useful for uniform API).
 * @param fn: transform to apply
 */
export const never = register("never", (func: any, pat: any) => _someBy(0, func, pat));
