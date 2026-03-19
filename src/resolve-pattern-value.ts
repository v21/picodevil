import { reify } from "@strudel/core";

/** Resolve the first value of a pattern at a given instant, returning a number. */
export function resolveValue(val: any, t: any): number {
  const evs = reify(val).queryArc(t, t);
  return evs.length ? Number(evs[0].value) : 0;
}
