import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

/**
 * Creates a pattern of still images. Images are served from the server component (default localhost:47426).
 *
 * @param {string | Pattern} pat mininotation string of image filenames, or an existing Pattern
 * @returns {Pattern} pattern of {_type: "image", src} objects
 * @example
 * $: image("photo.jpg")
 * $: image("a.png b.jpg")                 // alternates each cycle
 * $: image("photo.jpg").objectfit("contain").alpha(0.5)
 *
 */
export function image(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`image() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => {
    if (typeof v !== 'string') {
      warn(`image pattern produced non-string value: ${typeof v}`);
    }
    return { _type: "image", src: v };
  });
}
