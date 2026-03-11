import { stack, reify, Pattern } from "@strudel/core";
import "./visual-controls";

const PatternProto = Pattern.prototype as any;

type PatOrArr = any | any[];

function flattenPats(args: PatOrArr[]): any[] {
  return args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(reify);
}

function applyIndex(pats: any[], iLabel: string, countLabel: string): any {
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

function applyIndexNow(pats: any[], iLabel: string, countLabel: string): any {
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
 * Stacks patterns and labels each hap with `i` (position in array) and `count` (total).
 * Can also be called as a method: stack(a, b).index()
 *
 * @example
 * $: index(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 */
export function index(...args: PatOrArr[]): any {
  return applyIndex(flattenPats(args), "i", "count");
}

/**
 * Stacks patterns and labels co-active haps at query time with `i` and `count`.
 * `i` resets each query to reflect how many patterns are simultaneously active.
 *
 * @example
 * $: indexNow(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 */
export function indexNow(...args: PatOrArr[]): any {
  return applyIndexNow(flattenPats(args), "i", "count");
}

/**
 * Like index() but with custom label names for i and count.
 */
export function indexWith(iLabel: string, countLabel: string, ...args: PatOrArr[]): any {
  return applyIndex(flattenPats(args), iLabel, countLabel);
}

/**
 * Like indexNow() but with custom label names for i and count.
 */
export function indexNowWith(iLabel: string, countLabel: string, ...args: PatOrArr[]): any {
  return applyIndexNow(flattenPats(args), iLabel, countLabel);
}

// Method forms
PatternProto.index = function () {
  return index(this);
};

PatternProto.indexNow = function () {
  return indexNow(this);
};
