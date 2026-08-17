import type { Pattern } from "@strudel/mini";
import { pure } from "@strudel/core";
import { warn } from "./warnings";

/**
 * Renders a QR code as a source tile — white modules on a transparent background
 * (the quiet zone is transparent too, so Picodevil's black canvas shows through).
 * Error correction is level Q (~25%), and the default fit is `'contain'` so it
 * fills the tile square.
 *
 * The payload is a literal string — use single quotes. Double-quoted strings are
 * transpiled to mini() patterns, and the `/` in a URL parses as mininotation's
 * slow operator, so `qr("https://…")` would mangle the URL (same gotcha as
 * `.urlBase()`).
 *
 * There are no QR-specific styling controls: recolour or transform it with the
 * universal controls (`.brightness()`, `.tint()`, `.huerot()`, `.grey()`,
 * `.alpha()`, `.blend()`, `.width()`, `.grid()`, …) like any other source. Note
 * the modules are white, so hue-based effects need a starting colour (e.g.
 * `.tint()`) — `.huerot()` alone does nothing to white.
 *
 * @param {string | Pattern} pat payload string (usually a URL), or a pattern of strings
 * @returns {Pattern} pattern of QR source objects
 * @example
 * $: qr('https://picodevil.com')
 * $: qr('https://picodevil.com').tint(0.5, 1)      // recolour the white modules
 * $: s('clip.mp4'); qr('https://picodevil.com').width(0.3).x(0.35).y(0.35)
 */
export function qr(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`qr() expected string or Pattern, got ${typeof pat}`);
  }
  // String inputs use pure() — the whole string is one literal payload. Double-quoted
  // strings are transpiled to qr(mini("...")) before reaching here, so the Pattern
  // path still allows alternation (though a URL can't survive mininotation).
  const p: any = typeof pat === 'string' ? (pure as any)(pat) : pat;
  return p.withValue((v: unknown) => {
    if (typeof v !== 'string') {
      warn(`qr pattern produced non-string value: ${typeof v}`);
    }
    return { _type: 'qr', data: typeof v === 'string' ? v : String(v) };
  });
}
