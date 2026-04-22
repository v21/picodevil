/**
 * shuffleStack / shuffleStackCycle — permute the order of stacked pattern events.
 *
 * .shuffleStack(seed?) — Permutes co-active events at each instant query,
 * so .index() assigns shuffled i values.
 *
 * .shuffleStackCycle(seed?) — Queries the full cycle, groups events by onset
 * time, and shuffles within each onset group. This affects i assignment from
 * .indexCycle() for events that share the same onset (ties). Events at
 * different onset times keep their temporal order since indexCycle sorts by
 * onset.
 */
import { reify, Pattern, steady, pure } from "@strudel/core";
import { createMixParam } from "./create-mix-param";
import { nextLayoutParent, deriveRandSeed } from "./layout-counter";
import "./visual-controls";

const PatternProto = Pattern.prototype as any;

// FNV-1a 32-bit hash — same as index-patterns.ts / grid-stack.ts
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// MurmurHash3 finalizer — produces well-distributed 32-bit integers.
function murmurFinalize(x: number): number {
  x |= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Generate a permutation of [0..count-1] using a seeded Fisher-Yates shuffle.
 */
function shuffledPermutation(count: number, seed: number): number[] {
  const perm = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const r = murmurFinalize(seed ^ murmurFinalize(i)) / 4294967296;
    const j = Math.floor(r * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/**
 * Resolve seed pattern at a query arc to an integer.
 */
function resolveSeed(seedPat: any, begin: any, end: any, count: number): number {
  const seedHaps = seedPat.queryArc(Number(begin), Number(end));
  const seedVal = seedHaps.length > 0 ? Number(seedHaps[0].value) : 0;
  return hashStr(`${seedVal}:${count}`);
}

// Internal mix param for resolving seed values with the same logic as other controls.
// _perEvent patterns (rand) get sampled per-event (= per cycle for a pure(0) carrier),
// while discrete/continuous patterns get frame-time resolution.
const _shuffleSeed = createMixParam("_shuffleSeed");

/** The event's onset time — uses whole.begin when available. */
function hapOnset(hap: any): number {
  return Number(hap.whole?.begin ?? hap.part.begin);
}

// ─── .shuffleStack(seed?) — co-active permutation ───────────────────────────

/**
 * Permutes the order of events returned by this pattern's query.
 * Designed to go before .index() so that i values reflect the shuffled order.
 *
 * @param seedPat - Seed pattern (or number/string). Controls when the shuffle
 *   changes. "1 2 3 4" = 4 shuffles per cycle. No arg = one fixed shuffle.
 *
 * @example
 * stack(a, b, c, d).shuffleStack(42).index().rowscols(2).gridMod()
 * stack(a, b, c, d).shuffleStack("1 2 3 4").index().rowscols(2).gridMod()
 */
PatternProto.shuffleStack = function (seedPat?: any) {
  const self = this;
  const seed = seedPat !== undefined ? reify(seedPat) : steady(0);

  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const haps = self.query(state);
    if (haps.length <= 1) return haps;

    const intSeed = resolveSeed(seed, begin, end, haps.length);
    const perm = shuffledPermutation(haps.length, intSeed);
    return perm.map((idx) => haps[idx]);
  });
};

// ─── .shuffleStackCycle(seed?) — temporal onset-group permutation ────────────

/**
 * Permutes events within each onset-time group across the full cycle.
 * Designed to go before .indexCycle(). Events at the same onset time get
 * shuffled; events at different onset times keep their temporal order
 * (since indexCycle sorts by onset).
 *
 * For the common case of all-simultaneous stacked patterns (all sharing
 * onset 0), this shuffles the entire stack — same as shuffleStack.
 * The difference matters when sources have different subdivisions:
 * stack("a b", "c") has onset groups {0: [a, c], 0.5: [b]}.
 *
 * @param seedPat - Seed pattern (or number/string). No arg = one fixed shuffle.
 *
 * @example
 * stack(a, b, c).shuffleStackCycle(42).indexCycle().rowscols(2).gridMod()
 */
PatternProto.shuffleStackCycle = function (seedPat?: any) {
  const self = this;
  const seed = seedPat !== undefined ? reify(seedPat) : steady(0);

  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const cBegin = begin.floor ? Number(begin.floor()) : Math.floor(Number(begin));

    const haps = self.query(state);
    if (haps.length <= 1) return haps;

    // Resolve seed via createMixParam applied to a one-cycle carrier.
    // This delegates to the same logic as other controls:
    // - _perEvent (rand, irand): appLeft samples at carrier's whole span (one per cycle)
    // - discrete ("1 2"): frame-time combiner picks the active event
    // - continuous (sine): frame-time combiner samples at query time
    const carrier = _shuffleSeed(seed, pure(0));
    const seedHaps = carrier.queryArc(Number(begin), Number(end));
    const seedVal = seedHaps.length > 0 ? Number(seedHaps[0].value._shuffleSeed) : 0;
    const intSeed = hashStr(`${seedVal}:${haps.length}`);

    // Group events by onset time (relative to cycle start for consistency across cycles)
    const groups = new Map<string, any[]>();
    const groupOrder: string[] = [];
    for (const hap of haps) {
      const key = String(hapOnset(hap) - cBegin);
      if (!groups.has(key)) {
        groups.set(key, []);
        groupOrder.push(key);
      }
      groups.get(key)!.push(hap);
    }

    // Shuffle within each onset group
    const result: any[] = [];
    for (const key of groupOrder) {
      const group = groups.get(key)!;
      if (group.length <= 1) {
        result.push(...group);
        continue;
      }
      const groupSeed = hashStr(`${key}:${intSeed}`);
      const groupPerm = shuffledPermutation(group.length, groupSeed);
      for (const idx of groupPerm) {
        result.push(group[idx]);
      }
    }

    return result;
  });
};

// ─── .shuffleIndex(seed?) — assign shuffled i without reordering events ──────

/**
 * Assigns shuffled `i` (and `count`) to events without changing their order.
 * Like `.index()` but with grid cell assignments randomized per seed.
 * Events stay in their original query order (pool identity / stacking is preserved).
 *
 * @param seedPat - Seed pattern (or number/string). No arg = fixed shuffle (seed 0).
 *
 * @example
 * stack(a, b, c, d).shuffleIndex(42).rowscols(2).gridMod()
 */
PatternProto.shuffleIndex = function (seedPat?: any) {
  const self = this;
  const seed = seedPat !== undefined ? reify(seedPat) : steady(0);
  const callId = nextLayoutParent();

  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const haps: any[] = self.queryArc(Number(begin), Number(end));
    if (haps.length === 0) return haps;

    // Assign group indices with same layoutParent grouping as applyIndex
    const groupOrder: string[] = [];
    const eventGroupIdx: number[] = new Array(haps.length);
    for (let i = 0; i < haps.length; i++) {
      const hap = haps[i];
      const lp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
      const key = lp !== undefined ? `lp:0:${lp}` : `ev:${i}`;
      let gIdx = groupOrder.indexOf(key);
      if (gIdx === -1) { gIdx = groupOrder.length; groupOrder.push(key); }
      eventGroupIdx[i] = gIdx;
    }

    const count = groupOrder.length;
    const intSeed = resolveSeed(seed, begin, end, count);
    const perm = shuffledPermutation(count, intSeed);

    return haps.map((hap: any, i: number) => {
      const shuffledI = perm[eventGroupIdx[i]];
      const sourceLp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
      const randSeed = deriveRandSeed(callId, shuffledI, state, sourceLp);
      return hap.withValue((v: any) => ({
        ...(Object(v) === v ? v : {}),
        i: shuffledI,
        count,
        _randSeed: randSeed,
      }));
    });
  });
};

// ─── .shuffleIndexCycle(seed?) — cycle-order i, shuffled ─────────────────────

/**
 * Assigns shuffled `i` (and `count`) based on full-cycle onset order, without
 * changing event order. Like `.indexCycle()` but with cell assignments randomized.
 *
 * @param seedPat - Seed pattern (or number/string). No arg = fixed shuffle (seed 0).
 *
 * @example
 * stack(a, b, c, d).shuffleIndexCycle(42).rowscols(2).gridMod()
 */
PatternProto.shuffleIndexCycle = function (seedPat?: any) {
  const self = this;
  const seed = seedPat !== undefined ? reify(seedPat) : steady(0);
  const callId = nextLayoutParent();

  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const cBegin = begin.floor ? Number(begin.floor()) : Math.floor(Number(begin));

    // Full-cycle query to establish onset order
    const cycleHaps: any[] = self.queryArc(cBegin, cBegin + 1);
    if (cycleHaps.length === 0) return [];

    // Sort by onset (stable — preserves insertion order for ties)
    const sorted = cycleHaps
      .map((hap: any, i: number) => ({ hap, origIdx: i }))
      .sort((a: any, b: any) => hapOnset(a.hap) - hapOnset(b.hap));

    // Assign group indices with layoutParent grouping (same as applyIndexCycle)
    const groupOrder: string[] = [];
    const eventGroupIdx: number[] = new Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const { hap } = sorted[i];
      const lp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
      const key = lp !== undefined ? `lp:0:${lp}` : `ev:${i}`;
      let gIdx = groupOrder.indexOf(key);
      if (gIdx === -1) { gIdx = groupOrder.length; groupOrder.push(key); }
      eventGroupIdx[i] = gIdx;
    }

    const count = groupOrder.length;
    const intSeed = resolveSeed(seed, begin, end, count);
    const perm = shuffledPermutation(count, intSeed);

    // Build a map from origIdx → shuffledI for the current frame filter
    const origIdxToShuffledI = new Map<number, number>();
    for (let i = 0; i < sorted.length; i++) {
      origIdxToShuffledI.set(sorted[i].origIdx, perm[eventGroupIdx[i]]);
    }

    // Return only events within [begin, end), in their original query order
    return cycleHaps
      .map((hap: any, origIdx: number) => ({ hap, origIdx }))
      .filter(({ hap }: any) =>
        Number(hap.part.begin) < Number(end) && Number(hap.part.end) > Number(begin)
      )
      .map(({ hap, origIdx }: any) => {
        const shuffledI = origIdxToShuffledI.get(origIdx)!;
        const sourceLp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
        const randSeed = deriveRandSeed(callId, shuffledI, state, sourceLp);
        return hap.withValue((v: any) => ({
          ...(Object(v) === v ? v : {}),
          i: shuffledI,
          count,
          _randSeed: randSeed,
        }));
      });
  });
};
