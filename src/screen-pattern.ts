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

  // Looks like a filename (has a dot, no spaces, no parens) but extension wasn't recognised
  if (v.includes(".") && !v.includes(" ") && !v.includes("(")) {
    warn(`screen(): "${v}" looks like a filename but has an unrecognised extension — treating as CSS color. Did you mean a video or image?`);
  }
  return { _type: "color", color: v };
}

/**
 * Auto-detecting source pattern. Resolves each token via the media registry,
 * then by file extension, then falls back to treating it as a CSS color.
 * Also available as `s()`.
 *
 * @param {string | Pattern} pat mininotation string or Pattern of token values
 * @returns {Pattern} pattern of typed source objects
 * @example
 * $: s("myclip")                     // registry-named video or image
 * $: s("myclip red blue")            // mix video and colors
 * $: s("clip.mp4 photo.jpg")         // extension fallback
 * $: s("red blue green")             // solid colors
 * $: s("clip.mp4:.2:.7")             // inline begin/end: play 20%–70% of clip
 * $: s("clip.mp4:.3")                // inline begin only: play from 30% to end
 * $: s("a.mp4:.0:.5 b.mp4:.5:1")    // different ranges per token
 *
 */
export function screen(pat: string | Pattern): Pattern {
  if (typeof pat !== "string" && !(pat && typeof (pat as any).queryArc === "function")) {
    warn(`screen() expected string or Pattern, got ${typeof pat}`);
  }
  const p = typeof pat === "string" ? mini(pat) : pat;
  return new PatternClass((state: any) => {
    return p.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      return hap.withValue((v: unknown) => {
        if (typeof v === "object" && v !== null && "_type" in v) {
          const typed = v as any;
          if (typed._type === "video" && typed.begin == null) {
            return { begin: 0, end: 1, ...typed };
          }
          return v;
        }
        // mini() parses "name:begin:end" into [name, begin, end]
        if (Array.isArray(v)) {
          const [name, begin, end] = v as [string, number?, number?];
          const classified = classifyToken(name) as any;
          const result = classified._type === "video"
            ? { begin: 0, end: 1, ...classified }
            : { ...classified };
          if (begin !== undefined) result.begin = begin;
          if (end !== undefined) result.end = end;
          return result;
        }
        if (typeof v !== "string") {
          warn(`screen pattern produced non-string value: ${typeof v}`);
          return { _type: "color", color: "black" };
        }
        const classified = classifyToken(v);
        if ((classified as any)._type === "video") {
          return { begin: 0, end: 1, ...classified };
        }
        return classified;
      });
    });
  });
}

export const s = screen;
