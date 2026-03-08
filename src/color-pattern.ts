import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

/**
 * Create a color pattern. Returns a plain Strudel Pattern with _type: "color".
 * Accepts a mininotation string of CSS color names/hex codes.
 */
export function color(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`color() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => {
    if (typeof v !== 'string') {
      warn(`color pattern produced non-string value: ${typeof v}`);
    }
    return { _type: "color", color: v };
  });
}
