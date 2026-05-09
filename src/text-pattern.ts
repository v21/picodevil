import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { pure } from "@strudel/core";
import { warn } from "./warnings";

/**
 * Renders a text string as a source tile.
 *
 * The text is drawn onto a canvas sized to fit the content (with padding).
 * Use `.font()`, `.fontSize()`, `.fontColor()`, and `.fontBGColor()` to
 * style the text. By default text renders at native canvas pixel size
 * (objectfit "none"), so `.fontSize(36)` means 36px on screen.
 *
 * Use single-quoted strings to pass multi-word or multi-line text, since
 * double-quoted strings are transpiled to mini() patterns (alternation).
 *
 * @param {string | Pattern} pat text string or pattern of strings
 * @returns {Pattern} pattern of text source objects
 * @example
 * $: text('hello world')
 * $: text('line one\nline two').fontSize(48)
 * $: text('hello').font('bold IBM Plex Mono').fontColor('cyan')
 * $: text('A B C').fontSize("24 48")      // alternates font sizes
 * $: text('hi').fontBGColor('black').fontColor('white')
 */
export function text(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`text() expected string or Pattern, got ${typeof pat}`);
  }
  // String inputs use pure() — treat the whole string as a literal text value.
  // Double-quoted strings are transpiled to text(mini("...")) before reaching here,
  // so mini() alternation is still available via the Pattern path.
  const p: any = typeof pat === 'string' ? (pure as any)(pat) : pat;
  return p.withValue((v: unknown) => {
    if (typeof v !== 'string') {
      warn(`text pattern produced non-string value: ${typeof v}`);
    }
    return { _type: 'text', text: typeof v === 'string' ? v : String(v) };
  });
}
