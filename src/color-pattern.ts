import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";

/**
 * Create a color pattern. Returns a plain Strudel Pattern with _type: "color".
 * Accepts a mininotation string of CSS color names/hex codes.
 */
export function color(pat: string | Pattern): Pattern {
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => ({ _type: "color", color: v }));
}
