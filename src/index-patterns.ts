import { reify, Pattern } from "@strudel/core";
import "./visual-controls";
import { nextLayoutParent, deriveRandSeed } from "./layout-counter";

const PatternProto = Pattern.prototype as any;

type PatOrArr = any | any[];

function flattenPats(args: PatOrArr[]): any[] {
  return args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(reify);
}

/** The event's onset time — uses whole.begin when available (gives true onset even in clipped queries). */
function hapOnset(hap: any): number {
  return Number(hap.whole?.begin ?? hap.part.begin);
}

/**
 * Query each source pattern separately and return tagged haps with their source index.
 * Querying separately preserves per-slot identity so we can inject different randSeeds per slot.
 */
function querySeparately(
  pats: any[],
  begin: any,
  end: any,
): { hap: any; srcIdx: number }[] {
  const result: { hap: any; srcIdx: number }[] = [];
  for (let j = 0; j < pats.length; j++) {
    for (const hap of pats[j].queryArc(begin, end))
      result.push({ hap, srcIdx: j });
  }
  return result;
}

function applyIndexCycle(pats: any[], iLabel: string, countLabel: string): any {
  const callId = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const cBegin = begin.floor ? begin.floor() : Math.floor(Number(begin));

    // Full-cycle query per source pattern to establish temporal order
    const cycleTagged = querySeparately(pats, Number(cBegin), Number(cBegin) + 1);
    // Sort by onset (stable — preserves insertion order for ties, keeping slot identity)
    cycleTagged.sort((a, b) => hapOnset(a.hap) - hapOnset(b.hap));

    // Assign group indices with same layoutParent grouping as applyIndex
    const groupOrder: string[] = [];
    const eventGroupIdx: number[] = new Array(cycleTagged.length);
    for (let i = 0; i < cycleTagged.length; i++) {
      const { hap, srcIdx } = cycleTagged[i];
      const lp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
      const key = lp !== undefined ? `lp:${srcIdx}:${lp}` : `ev:${i}`;
      let gIdx = groupOrder.indexOf(key);
      if (gIdx === -1) { gIdx = groupOrder.length; groupOrder.push(key); }
      eventGroupIdx[i] = gIdx;
    }

    const count = groupOrder.length;

    // Track sub-index within each (srcIdx, onset) group so multiple haps from the same
    // source at the same onset each get the right slot (one per re-query, taken by index).
    const subIdxCounters = new Map<string, number>();

    const result: any[] = [];
    for (let i = 0; i < cycleTagged.length; i++) {
      const { hap: cycleHap, srcIdx } = cycleTagged[i];
      const gIdx = eventGroupIdx[i];
      const onset = hapOnset(cycleHap);
      const onsetKey = String(onset);
      if (Number(cycleHap.part.begin) > Number(end) || Number(cycleHap.part.end) <= Number(begin))
        continue;

      const groupKey = `${srcIdx}:${onsetKey}`;
      const subIdx = subIdxCounters.get(groupKey) ?? 0;
      subIdxCounters.set(groupKey, subIdx + 1);

      const sourceLp = Object(cycleHap.value) === cycleHap.value ? cycleHap.value.layoutParent : undefined;
      const seed = deriveRandSeed(callId, gIdx, state, sourceLp);
      result.push(
        cycleHap.withValue((v: any) => ({
          ...(Object(v) === v ? v : {}),
          [iLabel]: gIdx,
          [countLabel]: count,
          _randSeed: seed,
        })),
      );
    }
    return result;
  });
}

function applyIndex(pats: any[], iLabel: string, countLabel: string): any {
  const callId = nextLayoutParent();
  return new Pattern((state: any) => {
    // Query each source at the current arc in insertion order
    const arcTagged = querySeparately(pats, state.span.begin, state.span.end);

    // Assign group indices: events with layoutParent share a group key per (srcIdx, layoutParent);
    // events without layoutParent each get their own group (preserves existing behaviour).
    const groupOrder: string[] = [];
    const eventGroupIdx: number[] = new Array(arcTagged.length);
    for (let i = 0; i < arcTagged.length; i++) {
      const { hap, srcIdx } = arcTagged[i];
      const lp = Object(hap.value) === hap.value ? hap.value.layoutParent : undefined;
      const key = lp !== undefined ? `lp:${srcIdx}:${lp}` : `ev:${i}`;
      let gIdx = groupOrder.indexOf(key);
      if (gIdx === -1) { gIdx = groupOrder.length; groupOrder.push(key); }
      eventGroupIdx[i] = gIdx;
    }

    const count = groupOrder.length;
    const subIdxCounters = new Map<string, number>();
    const result: any[] = [];

    for (let i = 0; i < arcTagged.length; i++) {
      const { hap: ev, srcIdx } = arcTagged[i];
      const gIdx = eventGroupIdx[i];
      const onset = hapOnset(ev);
      const onsetKey = String(onset);

      const groupKey = `${srcIdx}:${onsetKey}`;
      const subIdx = subIdxCounters.get(groupKey) ?? 0;
      subIdxCounters.set(groupKey, subIdx + 1);

      const sourceLp = Object(ev.value) === ev.value ? ev.value.layoutParent : undefined;
      const seed = deriveRandSeed(callId, gIdx, state, sourceLp);
      result.push(
        ev.withValue((v: any) => ({
          ...(Object(v) === v ? v : {}),
          [iLabel]: gIdx,
          [countLabel]: count,
          _randSeed: seed,
        })),
      );
    }
    return result;
  });
}

/**
 * Stacks patterns and labels co-active haps at query time with `i` and `count`.
 * `i` resets each query to reflect how many patterns are simultaneously active.
 * Each slot gets a unique `randSeed` injected, so `rand` and friends are decorrelated
 * across slots without any extra configuration.
 *
 * @example
 * $: index(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 */
export function index(...args: PatOrArr[]): any {
  return applyIndex(flattenPats(args), "i", "count");
}

/**
 * Stacks patterns and labels each hap with `i` (position in cycle order) and `count` (total).
 * Each slot gets a unique `randSeed` injected, so `rand` and friends are decorrelated
 * across slots without any extra configuration.
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

// Method forms
PatternProto.index = function () {
  return applyIndex([this], "i", "count");
};

PatternProto.indexCycle = function () {
  return applyIndexCycle([this], "i", "count");
};
