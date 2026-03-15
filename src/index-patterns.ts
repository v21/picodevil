import { stack, reify, Pattern } from "@strudel/core";
import "./visual-controls";

const PatternProto = Pattern.prototype as any;

type PatOrArr = any | any[];

function flattenPats(args: PatOrArr[]): any[] {
  return args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(reify);
}

function applyIndexCycle(pats: any[], iLabel: string, countLabel: string): any {
  const stacked = stack(...pats);
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    // Query full cycle to determine temporal order of all haps
    const cBegin = begin.floor ? begin.floor() : Math.floor(Number(begin));
    const cEnd = Number(cBegin) + 1;
    const cycleEvs = stacked.queryArc(Number(cBegin), cEnd);
    // Sort by onset time (stable — preserves insertion order for ties)
    cycleEvs.sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));
    const count = cycleEvs.length;
    // Label cycle events and filter to current arc
    return cycleEvs
      .map((ev: any, i: number) =>
        ev.withValue((v: any) => ({
          ...(Object(v) === v ? v : {}),
          [iLabel]: i,
          [countLabel]: count,
        }))
      )
      .filter((ev: any) =>
        Number(ev.part.begin) < Number(end) && Number(ev.part.end) > Number(begin)
      );
  });
}

function applyIndex(pats: any[], iLabel: string, countLabel: string): any {
  // At query time, find all co-active haps and label them by their order
  const stacked = stack(...pats);
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const evs = stacked.queryArc(begin, end);
    const count = evs.length;
    return evs.map((ev: any, i: number) =>
      ev.withValue((v: any) => ({
        ...(Object(v) === v ? v : {}),
        [iLabel]: i,
        [countLabel]: count,
      }))
    );
  });
}

/**
 * Stacks patterns and labels co-active haps at query time with `i` and `count`.
 * `i` resets each query to reflect how many patterns are simultaneously active.
 *
 * @example
 * $: index(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 */
export function index(...args: PatOrArr[]): any {
  return applyIndex(flattenPats(args), "i", "count");
}

/**
 * Stacks patterns and labels each hap with `i` (position in cycle order) and `count` (total).
 * Can also be called as a method: stack(a, b).indexCycle()
 *
 * @example
 * $: indexCycle(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 */
export function indexCycle(...args: PatOrArr[]): any {
  return applyIndexCycle(flattenPats(args), "i", "count");
}

/**
 * Like index() but with custom label names for i and count.
 */
export function indexWith(iLabel: string, countLabel: string, ...args: PatOrArr[]): any {
  return applyIndex(flattenPats(args), iLabel, countLabel);
}

/**
 * Like indexCycle() but with custom label names for i and count.
 */
export function indexCycleWith(iLabel: string, countLabel: string, ...args: PatOrArr[]): any {
  return applyIndexCycle(flattenPats(args), iLabel, countLabel);
}

// ─── autoseed ─────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function applyAutoseed(pat: any, saltPat: any): any {
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const cBegin = begin.floor ? begin.floor() : Math.floor(Number(begin));
    const cycle = Math.round(Number(cBegin));
    const saltEvs = saltPat.query(state);
    const saltVal = saltEvs.length > 0 ? saltEvs[0].value : 0;

    // Full-cycle query to establish temporal ordering (same logic as applyIndexCycle)
    const cycleEvs = pat.queryArc(Number(cBegin), Number(cBegin) + 1);
    cycleEvs.sort((a: any, b: any) => Number(a.part.begin) - Number(b.part.begin));

    // Map each unique onset to its cycle-order index
    const onsetToIndex = new Map<string, number>();
    for (let i = 0; i < cycleEvs.length; i++) {
      const key = String(Number(cycleEvs[i].part.begin));
      if (!onsetToIndex.has(key)) onsetToIndex.set(key, i);
    }

    // Collect unique onsets active in the current arc
    const activeOnsets = new Set<string>();
    for (const ev of cycleEvs) {
      if (Number(ev.part.begin) < Number(end) && Number(ev.part.end) > Number(begin))
        activeOnsets.add(String(Number(ev.part.begin)));
    }

    // Re-query once per active onset with its own randSeed, collect only matching haps
    const result: any[] = [];
    for (const onset of activeOnsets) {
      const seed = hashStr(`${saltVal}:${onsetToIndex.get(onset)}:${cycle}`);
      for (const hap of pat.query(state.setControls({ randSeed: seed })))
        if (String(Number(hap.part.begin)) === onset) result.push(hap);
    }
    return result;
  });
}

/**
 * Injects a deterministic `randSeed` into the query state so that `rand` and other
 * random signals are automatically scoped. Pass an optional salt (number, string, or
 * Pattern) to differentiate multiple autoseed calls from one another.
 *
 * @example
 * $: video("a.mp4").x(rand).autoseed(1)
 * $: video("b.mp4").x(rand).autoseed(2)
 */
export function autoseed(pat: any, salt?: any): any {
  return applyAutoseed(reify(pat), reify(salt ?? 0));
}

// Method forms
PatternProto.index = function () {
  return index(this);
};

PatternProto.indexCycle = function () {
  return indexCycle(this);
};

PatternProto.autoseed = function (salt?: any) {
  return applyAutoseed(this, reify(salt ?? 0));
};
