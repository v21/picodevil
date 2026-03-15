import { stack, Pattern, reify } from "@strudel/core";
import "./visual-controls";
export { cycle } from "./iterators";

// FNV-1a 32-bit hash — mirrors index-patterns.ts; used for per-slot randSeed injection
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}


/**
 * Stacks n copies of patterns, cycling through them to fill n slots.
 * n can be a pattern, resolved at query time. Each slot gets a unique randSeed
 * so `rand` and friends are decorrelated across copies automatically.
 *
 * @example
 * $: stackN(4, color("red"))                          // 4 red layers, each with different rand
 * $: stackN(4, color("red"), color("blue"))           // red, blue, red, blue
 * $: stackN(sine.range(1,4).slow(4), color("red"))   // dynamic count
 */
export function stackN(n: any, ...args: any[]): Pattern {
  const pats = args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(reify);
  if (!pats.length) return stack();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const nEvs = reify(n).queryArc(Number(begin), Number(end));
    if (nEvs.length === 0) return [];
    const cycle = Math.round(Math.floor(Number(begin)));
    return nEvs.flatMap((nEv: any) => {
      const count = Math.max(1, Math.round(Number(nEv.value)));
      const slotState = state.withSpan(() => nEv.part);
      const result: any[] = [];
      for (let i = 0; i < count; i++) {
        const seed = hashStr(`${i}:${cycle}`);
        for (const hap of pats[i % pats.length].query(slotState.setControls({ randSeed: seed }))) {
          result.push(hap.withValue((v: any) => ({
            ...(Object(v) === v ? v : {}),
            i,
            count,
          })));
        }
      }
      return result;
    });
  });
}

function resolveNum(val: any, begin: any, end: any): number {
  const evs = reify(val).queryArc(begin, end);
  return evs.length ? Math.round(Number(evs[0].value)) : 0;
}

function takeFromIterable(iter: Iterable<any>, n: number): any[] {
  const result: any[] = [];
  for (const item of iter) {
    result.push(item);
    if (result.length >= n) break;
  }
  return result;
}

/**
 * Distributes patterns across cells in a grid, cycling children if there are more cells than patterns.
 * Accepts an array, a single pattern, or any iterable (e.g. .iteratorWith() generator).
 * Iterables are consumed lazily at query time, pulling exactly cols×rows items.
 *
 * @param {Pattern | Pattern[] | Iterable<Pattern>} children patterns or iterable of patterns
 * @param {number | Pattern} cols number of columns (can be a pattern), default 2
 * @param {number | Pattern} rows number of rows (can be a pattern), defaults to cols
 * @returns {Pattern} stacked pattern with each child assigned to grid cells via .gridModulo()
 * @example
 * $: gridStack([color("red"), color("blue"), video("clip.mp4")], 2, 2)
 * $: gridStack(video("clip.mp4").iteratorWith((x, i) => x.speed(i * 0.5 + 0.5)), 2, 2)
 *
 */
export function gridStack(children: Pattern | Pattern[] | Iterable<Pattern>, cols: any = 2, rows: any = cols): Pattern {
  if (!Array.isArray(children) && typeof (children as any)[Symbol.iterator] === 'function' && typeof (children as any).queryArc !== 'function') {
    const iter = children as Iterable<Pattern>;
    return new Pattern((state: any) => {
      const { begin, end } = state.span;
      const c = resolveNum(cols, begin, end);
      const r = resolveNum(rows, begin, end);
      const n = c * r;
      const arr = takeFromIterable(iter, n);
      return stack(...arr.map((child: any, i: number) =>
        child.gridModulo(i, n, c, r)
      )).query(state);
    });
  }
  const arr = Array.isArray(children) ? children : [children as Pattern];
  return stack(...(arr as any[]).map((child, i) =>
    child.gridModulo(i, arr.length, cols, rows)
  ));
}

(Pattern.prototype as any).stackN = function (n: any) {
  return stackN(n, this);
};
