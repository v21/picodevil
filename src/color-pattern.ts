import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

/**
 * Creates a pattern of solid colors. Accepts a mininotation string of CSS color names or hex codes.
 *
 * @param {string | Pattern} pat mininotation string or existing Pattern of color values
 * @returns {Pattern} pattern of {_type: "color", color} objects
 * @example
 * $: color("red blue green")           // three colors per cycle
 * $: color("#ff0000 cyan darkblue")    // hex and named colors
 * $: color("<red blue> <green yellow>") // alternates across cycles
 *
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
