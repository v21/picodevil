import type { Pattern } from "@strudel/mini";
import { Pattern as PatternClass } from "@strudel/core";
import { mini } from "@strudel/mini";
import { warn } from "./warnings";
import { resolveMedia } from "./media-registry";

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi", "ogv"]);
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"]);

function classifyToken(v: string): object {
  const entry = resolveMedia(v);
  if (entry) return { _type: entry.type, src: v };

  const ext = v.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTS.has(ext)) return { _type: "video", src: v };
  if (IMAGE_EXTS.has(ext)) return { _type: "image", src: v };

  return { _type: "color", color: v };
}

/**
 * Auto-detecting source pattern. Resolves each token via the media registry,
 * then by file extension, then falls back to treating it as a CSS color.
 *
 * @param {string | Pattern} pat mininotation string or Pattern of token values
 * @returns {Pattern} pattern of typed source objects
 * @example
 * $: s("myclip")                     // registry-named video or image
 * $: s("myclip red blue")            // mix video and colors
 * $: s("clip.mp4 photo.jpg")         // extension fallback
 * $: s("red blue green")             // solid colors
 *
 * Note: for video tokens, `_onset` (the event's `whole.begin`) is baked into the
 * value so that it survives subsequent `set.mix` (appBoth) calls such as `.alpha()`
 * or `.speed()`. Without this, those controls would clip `whole.begin` to each cycle
 * boundary and the video would restart every cycle regardless of `/N` slowing.
 * See also: `video()` in video-pattern.ts, `eventBeginFromHap` in main.ts.
 */
export function screen(pat: string | Pattern): Pattern {
  if (typeof pat !== "string" && !(pat && typeof (pat as any).queryArc === "function")) {
    warn(`screen() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === "string" ? mini(pat) : pat;
  // Wrap in PatternClass constructor to access hap.whole.begin and bake _onset
  // into video values — same as video() does. Without this, set.mix (.alpha etc.)
  // clips whole.begin to each cycle boundary and videos restart every cycle.
  return new PatternClass((state: any) => {
    return p.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      return hap.withValue((v: unknown) => {
        // Already-typed value (e.g. from color(), video(), image()) — pass through,
        // but still bake _onset for video types that don't have it yet.
        if (typeof v === "object" && v !== null && "_type" in v) {
          const typed = v as any;
          if (typed._type === "video" && typed._onset == null) {
            return { ...typed, _onset: Number(hap.whole.begin) };
          }
          return v;
        }
        if (typeof v !== "string") {
          warn(`screen pattern produced non-string value: ${typeof v}`);
          return { _type: "color", color: "black" };
        }
        const classified = classifyToken(v);
        // Bake _onset for video events so it survives subsequent set.mix calls
        if ((classified as any)._type === "video") {
          return { ...classified, _onset: Number(hap.whole.begin) };
        }
        return classified;
      });
    });
  });
}

export const s = screen;
