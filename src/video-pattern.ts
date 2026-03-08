import type { Pattern } from "@strudel/mini";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

/**
 * Creates a pattern of video sources. Videos are served from the server component (default localhost:3456).
 *
 * @param {string | Pattern} pat mininotation string of video filenames, or an existing Pattern
 * @returns {Pattern} pattern of {_type: "video", src} objects
 * @example
 * $: video("clip1.mp4")                   // single video, fullscreen
 * $: video("clip1.mp4 clip2.mp4")         // alternates each cycle
 * $: video("clip.mp4").speed(-1).fit("contain")
 *
 */
export function video(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`video() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === 'string' ? mini(pat) : pat;
  return p.withValue((v: string) => {
    if (typeof v !== 'string') {
      warn(`video pattern produced non-string value: ${typeof v}`);
    }
    return { _type: "video", src: v };
  });
}
