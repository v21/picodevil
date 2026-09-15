import type { Pattern } from "@strudel/mini";
import { reify } from "@strudel/core";
import { warn } from "./warnings";

/**
 * A soft radial fade as a **source**: white in the middle, fading to
 * transparency towards the corners. On its own it draws a soft-edged glow; its
 * real job is feeding `.matte()` — `.matte(vignette())` is the classic corner
 * fade that `.vignette()` used to be.
 *
 * The falloff is measured in the tile's own frame, so the untouched region is
 * the **ellipse inscribed in the tile**, not a circle: 0 at the centre, the
 * middle of each edge is the ellipse itself, and the corners sit furthest out.
 *
 * - `0` — no fade at all (a plain white tile).
 * - `1` — edge midpoints still fully opaque, corners fully transparent, smooth
 *   falloff between the two.
 * - `>1` — the fade keeps eating inward; around `4.4` the whole tile is gone.
 * - `<0` — sweeps the same soft band outward from the centre instead: the
 *   middle fades out and the corners stay.
 *
 * As a source it takes the universal controls like any other — `.width()`,
 * `.scale()`, `.rotate()`, `.tint()`, `.blend()` — so the mask can be sized and
 * placed independently of what it keys.
 *
 * @param {number | string | Pattern} [amount=1] fade amount: 0 = off, 1 = corners transparent, negative = fade the centre
 * @returns {Pattern} pattern of vignette source objects
 * @example
 * // classic corner fade — the old .vignette(1)
 * $: video("clip.mp4").matte(vignette(1))
 *
 * // tighter — closes in on the centre
 * $: video("clip.mp4").matte(vignette(2))
 *
 * // inverted: hole in the middle, corners intact
 * $: video("clip.mp4").matte(vignette(-1.5))
 *
 * // breathing iris over the whole composition
 * $: s("all").matte(vignette(sine.range(0, 3)))
 *
 * // drawn straight to the canvas: a soft white glow, recoloured
 * $: vignette(1).tint(0.6, 1).width(0.5)
 *
 * // a darkening overlay rather than a mask — corners opaque black
 * $: video("clip.mp4"); vignette(-3.414).brightness(-1)
 */
export function vignette(amount: number | string | Pattern = 1): Pattern {
  return (reify as any)(amount).withValue((v: unknown) => {
    const n = Number(v);
    if (!isFinite(n)) {
      warn(`vignette() expected a number, got ${typeof v === 'string' ? `"${v}"` : typeof v}`);
    }
    return { _type: 'vignette', vignette: isFinite(n) ? n : 0 };
  });
}
