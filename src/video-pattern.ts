import type { Pattern } from "@strudel/mini";
import { Pattern as PatternClass } from "@strudel/core";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";

/**
 * Creates a pattern of video sources. Videos are served from the server component (default localhost:3456).
 *
 * By default, video playback is synced to the Strudel event that produced it:
 * each time a new event starts, the video seeks to the position it should be
 * at that cycle. This means `video("a.mp4")` restarts from the beginning every
 * cycle, while `video("a.mp4").slow(5)` plays continuously for 5 cycles before
 * restarting.
 *
 * Note on controls: `.speed()`, `.alpha()`, and other controls use `appBoth`
 * (set.mix), which normally intersects event spans. For most controls this is
 * fine, but it does NOT affect playback timing — the onset is preserved
 * internally so that e.g. `video("a.mp4").slow(5).speed(2)` still plays
 * continuously for 5 cycles at double speed. This is intentional, but differs
 * from standard Strudel event-intersection behaviour.
 *
 * Use `.sync(n)` to override the reference cycle for playback (e.g. `.sync(0)`
 * makes the video play as if it started from cycle 0 regardless of event
 * boundaries).
 *
 * @param {string | Pattern} pat mininotation string of video filenames, or an existing Pattern
 * @returns {Pattern} pattern of {_type: "video", src} objects
 * @example
 * $: video("clip1.mp4")                        // single video, fullscreen
 * $: video("clip1.mp4 clip2.mp4")              // alternates each cycle
 * $: video("clip.mp4").speed(-1).fit("contain")
 * $: video("clip.mp4").slow(5).speed(2)        // plays 5 cycles at 2× speed
 * $: video("clip.mp4").sync(0)                 // plays freely from cycle 0
 *
 */
export function video(pat: string | Pattern): Pattern {
  if (typeof pat !== 'string' && !(pat && typeof (pat as any).queryArc === 'function')) {
    warn(`video() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === 'string' ? mini(pat) : pat;
  // Use Pattern constructor to access each hap's whole.begin and bake it in as
  // _onset. This survives subsequent set.mix (appBoth) calls — e.g. .speed(2)
  // intersects whole spans per cycle, but _onset in the value is preserved.
  return new PatternClass((state: any) => {
    return p.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      if (typeof hap.value !== 'string') {
        warn(`video pattern produced non-string value: ${typeof hap.value}`);
      }
      return hap.withValue(() => ({
        _type: "video",
        src: hap.value,
        _onset: Number(hap.whole.begin),
      }));
    });
  });
}
