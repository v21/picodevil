import { stack, Pattern, reify } from "@strudel/core";
import "./visual-controls";

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

(Pattern.prototype as any).stackN = function (n: any) {
  return stackN(n, this);
};
