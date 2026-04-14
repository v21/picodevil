import {
  Hap, Pattern as CorePattern, reify, TimeSpan,
} from "@strudel/core";
import { warn } from "./warnings";
import { resolveMedia } from "./media-registry";
import { getRuntimeCps } from "./config";

const PatternProto = CorePattern.prototype as any;

// ─── chop/striate/slice/splice wrappers ────────────────────────────────────────

function isVideoTyped(v: any): boolean {
  return v != null && typeof v === "object" && v._type === "video";
}

/**
 * Check if a pattern produces signal events (no whole span). Chop/striate/slice
 * need whole spans to subdivide. A bare signal source (e.g. `sine.chop(4)`) has
 * no whole spans. Note: signal *controls* (e.g. `.alpha(sine).chop(4)`) are fine
 * because createMixParam preserves the source's whole.
 */
function warnIfSignal(pat: any, method: string) {
  const evs = pat.queryArc(0, 1);
  if (evs.length > 0 && evs.every((e: any) => !e.whole)) {
    warn(`${method}() received a signal pattern (no event boundaries). Signal controls like .scrub(sine) or .speed(sine) must come after ${method}(), not before — e.g. .${method}(n).scrub(sine)`);
  }
}

// Save originals
const _origChop = PatternProto.chop;
const _origStriate = PatternProto.striate;

/**
 * Chops each event into n equal slices, setting begin/end on each sub-event.
 * For video, each slice shows a different portion of the video.
 *
 * Signal controls like `.scrub(sine)` or `.speed(sine)` must come after chop, not before,
 * as they erase event boundaries that chop needs.
 *
 * Composes with `.begin()`/`.end()`: `.begin(0.2).end(0.8).chop(4)` chops within the 20–80% region.
 *
 * @param {number | Pattern} n number of slices per event
 * @returns {Pattern} pattern with n sub-events per original event
 * @example
 * $: s("clip.mp4").chop(8)                      // 8 slices per cycle
 * $: s("clip.mp4").chop(8).rev()                // reversed within each cycle
 * $: s("clip.mp4").begin(0.2).end(0.8).chop(4)  // chop within region
 *
 */
PatternProto.chop = function (...args: any[]) {
  warnIfSignal(this, "chop");
  return _origChop ? _origChop.apply(this, args) : this;
};

/**
 * Like chop, but plays all slices simultaneously overlaid rather than sequentially.
 * Each event gets a different begin/end slice, all starting at the same time.
 *
 * @param {number | Pattern} n number of slices
 * @returns {Pattern} pattern with n overlapping sub-events
 * @example
 * $: s("clip.mp4").striate(4)                   // 4 overlapping slices
 *
 */
PatternProto.striate = function (...args: any[]) {
  warnIfSignal(this, "striate");
  return _origStriate ? _origStriate.apply(this, args) : this;
};

// ─── JSDoc stubs for Strudel builtins (so the reference plugin picks them up) ──

const _origRev = PatternProto.rev;

/**
 * Reverses the order of events within each cycle.
 * With chop, reverses the slices within each cycle (pairwise if slowed).
 *
 * @returns {Pattern} pattern with per-cycle reversal
 * @example
 * $: s("clip.mp4").chop(8).rev()                // slices reversed within each cycle
 * $: s("a.mp4 b.mp4 c.mp4").rev()              // plays c, b, a each cycle
 *
 */
PatternProto.rev = function (...args: any[]) {
  return _origRev.apply(this, args);
};

const _origRevv = PatternProto.revv;

/**
 * Reverses the entire pattern timeline (global reversal, not per-cycle).
 * Unlike rev() which reverses within each cycle, revv() reverses across all cycles.
 *
 * @returns {Pattern} pattern with global reversal
 * @example
 * $: s("clip.mp4").loopAt(4).chop(8).revv()     // all 8 slices in reverse order
 *
 */
PatternProto.revv = function (...args: any[]) {
  return _origRevv.apply(this, args);
};

function mergeSlice(original: any, sliceBeginEnd: { begin: number; end: number }): any {
  let b = sliceBeginEnd;
  if ('begin' in original && 'end' in original &&
      original.begin !== undefined && original.end !== undefined) {
    const d = original.end - original.begin;
    b = { begin: original.begin + b.begin * d, end: original.begin + b.end * d };
  }
  return Object.assign({}, original, b);
}

/**
 * Cuts the video into n slices and plays only the slices selected by the index pattern.
 * Unlike chop (which plays all slices sequentially), slice lets you pick which slices to play and in what order.
 *
 * @param {number | Pattern} n number of slices to divide the video into
 * @param {number | string | Pattern} ipat index pattern selecting which slices to play
 * @returns {Pattern} pattern playing the selected slices
 * @example
 * $: s("clip.mp4").slice(8, "0 3 5 7")          // play slices 0, 3, 5, 7
 * $: s("clip.mp4").slice(8, "0 1 2 3 4 5 6 7".rev()) // all slices reversed
 *
 */
PatternProto.slice = function (n: any, ipat: any) {
  const pat = this;
  const nPat = reify(n);
  const idxPat = reify(ipat);
  const func = (o: any) => {
    return nPat.innerBind((nVal: number) =>
      idxPat.fmap((i: number) => {
        const begin = Array.isArray(nVal) ? nVal[i] : i / nVal;
        const end = Array.isArray(nVal) ? nVal[i + 1] : (i + 1) / nVal;
        return mergeSlice(o, { begin, end });
      })
    );
  };
  return pat.squeezeBind(func);
};

/**
 * Like slice, but adjusts speed so each slice fills its event duration.
 * Combines slicing with speed-fitting — each selected slice plays at the right speed
 * to complete within its time slot.
 *
 * For video, uses the real video duration from the media registry for accurate speed.
 *
 * @param {number | Pattern} n number of slices to divide the video into
 * @param {number | string | Pattern} ipat index pattern selecting which slices to play
 * @returns {Pattern} pattern playing speed-fitted slices
 * @example
 * $: s("clip.mp4").splice(8, "0 3 5 7")         // play slices 0, 3, 5, 7 at fitted speed
 * $: s("clip.mp4").splice(4, "0 1 2 3")         // 4 speed-fitted slices per cycle
 *
 */
PatternProto.splice = function (n: any, ipat: any) {
  const sliced = this.slice(n, ipat);
  return new CorePattern((state: any) => {
    return sliced.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      if (!hap.whole || !hap.value || typeof hap.value !== 'object') return hap;
      const v = hap.value;
      const wholeDur = Number(hap.whole.end) - Number(hap.whole.begin);
      if (wholeDur <= 0) return hap;

      // For video events, use real duration from the media registry (fit-style)
      if (isVideoTyped(v) && v.src) {
        const entry = resolveMedia(v.src);
        const dur = entry?.duration;
        if (dur) {
          const cps = getRuntimeCps();
          const sliceDur = (v.end ?? 1) - (v.begin ?? 0);
          const speed = sliceDur * dur * cps / wholeDur;
          return hap.withValue((val: any) => ({ ...val, speed }));
        }
      }

      // Fallback: Strudel's formula (works for non-video or unknown duration)
      const nVal = Number(reify(n).queryArc(state.span.begin, state.span.begin)[0]?.value ?? n);
      const speedAdj = 1 / (nVal * wholeDur);
      return hap.withValue((val: any) => ({
        ...val,
        speed: speedAdj * (val.speed || 1),
      }));
    });
  });
};

/**
 * Tags pattern values as seconds. Currently unused — .begin()/.end() use 0-1 normalized values.
 * Retained for potential future absolute-time support.
 *
 * @returns {Pattern} pattern with values tagged as seconds
 * @deprecated begin/end now use 0-1 normalized values; absolute time support is planned for a future version
 */
PatternProto.sec = function () { return this.fmap((v: number) => v + "sec"); };

/**
 * Tags pattern values as milliseconds. Currently unused — .begin()/.end() use 0-1 normalized values.
 * Retained for potential future absolute-time support.
 *
 * @returns {Pattern} pattern with values tagged as milliseconds
 * @deprecated begin/end now use 0-1 normalized values; absolute time support is planned for a future version
 */
PatternProto.ms = function () { return this.fmap((v: number) => v + "ms"); };

// --- easing functions (Robert Penner's standard set) ---

const easings: Record<string, Record<string, (t: number) => number>> = {
  linear: {
    in: (t) => t,
    out: (t) => t,
    inout: (t) => t,
  },
  sine: {
    in: (t) => 1 - Math.cos((t * Math.PI) / 2),
    out: (t) => Math.sin((t * Math.PI) / 2),
    inout: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  },
  quad: {
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    inout: (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  },
  cubic: {
    in: (t) => t ** 3,
    out: (t) => 1 - (1 - t) ** 3,
    inout: (t) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  },
  quart: {
    in: (t) => t ** 4,
    out: (t) => 1 - (1 - t) ** 4,
    inout: (t) => t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2,
  },
  quint: {
    in: (t) => t ** 5,
    out: (t) => 1 - (1 - t) ** 5,
    inout: (t) => t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2,
  },
  expo: {
    in: (t) => t === 0 ? 0 : 2 ** (10 * t - 10),
    out: (t) => t === 1 ? 1 : 1 - 2 ** (-10 * t),
    inout: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  },
  circ: {
    in: (t) => 1 - Math.sqrt(1 - t * t),
    out: (t) => Math.sqrt(1 - (t - 1) ** 2),
    inout: (t) => t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
  },
  elastic: {
    in: (t) => t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3),
    out: (t) => t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
    inout: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2 + 1,
  },
  bounce: {
    out: (t) => {
      if (t < 1 / 2.75) return 7.5625 * t * t;
      if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
      if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
    in: (t) => 1 - easings.bounce.out(1 - t),
    inout: (t) => t < 0.5 ? (1 - easings.bounce.out(1 - 2 * t)) / 2 : (1 + easings.bounce.out(2 * t - 1)) / 2,
  },
  back: {
    in: (t) => 2.70158 * t ** 3 - 1.70158 * t * t,
    out: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    inout: (t) => {
      const c = 1.70158 * 1.525;
      return t < 0.5
        ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2
        : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
    },
  },
};

function getEase(curve: string, direction: string): (t: number) => number {
  const c = easings[curve];
  if (!c) throw new Error(`Unknown easing curve: "${curve}". Available: ${Object.keys(easings).join(", ")}`);
  const fn = c[direction];
  if (!fn) throw new Error(`Unknown easing direction: "${direction}". Available: in, out, inout`);
  return fn;
}

// --- shared: collect sorted events with numeric values from a source pattern ---

interface NumEvent { begin: number; end: number; value: number }

function collectEvents(src: any, t: number, padding = 1): NumEvent[] {
  const cycle = Math.floor(t);
  const evs = src.queryArc(cycle - padding, cycle + 1 + padding);
  const result: NumEvent[] = [];
  for (const ev of evs) {
    if (ev.whole) {
      result.push({
        begin: Number(ev.whole.begin),
        end: Number(ev.whole.end),
        value: Number(ev.value),
      });
    }
  }
  // deduplicate by begin time (queryArc can return overlapping cycles)
  result.sort((a, b) => a.begin - b.begin);
  const deduped: NumEvent[] = [];
  for (const ev of result) {
    if (!deduped.length || Math.abs(ev.begin - deduped[deduped.length - 1].begin) > 0.0001) {
      deduped.push(ev);
    }
  }
  return deduped;
}

function findCurrentIndex(evs: NumEvent[], t: number): number {
  for (let i = evs.length - 1; i >= 0; i--) {
    if (evs[i].begin <= t + 0.0001) return i;
  }
  return 0;
}

/**
 * Smoothly interpolates between discrete pattern values using an easing function, instead of stepping.
 *
 * @param {string | Pattern} curve easing curve name (or pattern of names): "linear", "sine", "quad", "cubic", "quart", "quint",
 *   "expo", "circ", "elastic", "bounce", "back"
 * @param {string | Pattern} direction easing direction (or pattern of directions): "in", "out", "inout"
 * @returns {Pattern} continuous pattern that transitions smoothly between values
 * @example
 * $: color("red").x("0 0.5".lerp())                       // smooth linear slide
 * $: video("clip.mp4").alpha("0 1".lerp("sine", "inout"))  // smooth sine fade
 * $: color("red").scale("0.5 1 0.5".lerp("bounce", "out")) // bouncy scale
 *
 */
PatternProto.lerp = function (curve: any = "linear", direction: any = "inout") {
  const src = this;
  const curvePat = reify(curve);
  const dirPat = reify(direction);
  return new CorePattern((state: any) => {
    const t = Number(state.span.begin);
    const evs = collectEvents(src, t);
    if (!evs.length) return [];

    const curveVal = curvePat.queryArc(t, t)[0]?.value ?? "linear";
    const dirVal = dirPat.queryArc(t, t)[0]?.value ?? "inout";
    const ease = getEase(String(curveVal), String(dirVal));

    const i = findCurrentIndex(evs, t);
    const cur = evs[i];
    const next = evs[i + 1] ?? cur;

    const span = cur.end - cur.begin;
    const frac = span > 0 ? (t - cur.begin) / span : 0;
    const val = cur.value + (next.value - cur.value) * ease(frac);
    return [new Hap(undefined, state.span, val)];
  });
};

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number, tension: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = tension * (p2 - p0);
  const m2 = tension * (p3 - p1);
  return (2 * t3 - 3 * t2 + 1) * p1
       + (t3 - 2 * t2 + t) * m1
       + (-2 * t3 + 3 * t2) * p2
       + (t3 - t2) * m2;
}

/**
 * Catmull-Rom spline interpolation between discrete pattern values. Produces very smooth curves
 * that pass through each value.
 *
 * @param {number | Pattern} tension smoothness of the curve (0 = sharp corners, 0.5 = default, 1 = very smooth)
 * @returns {Pattern} continuous pattern with smooth spline interpolation
 * @example
 * $: video("clip.mp4").x("0 0.3 0.7 1".spline())        // smooth path
 * $: color("red").alpha("0 1 0.5 1".spline(0.8))         // high-tension smooth alpha
 *
 */
PatternProto.spline = function (tension: any = 0.5) {
  const src = this;
  const tensionPat = reify(tension);
  return new CorePattern((state: any) => {
    const t = Number(state.span.begin);
    const evs = collectEvents(src, t);
    if (!evs.length) return [];

    const tensionVal = Number(tensionPat.queryArc(t, t)[0]?.value ?? 0.5);

    const i = findCurrentIndex(evs, t);
    const cur = evs[i];

    // clamp indices for the 4 control points
    const prev = evs[Math.max(0, i - 1)];
    const next = evs[Math.min(evs.length - 1, i + 1)];
    const next2 = evs[Math.min(evs.length - 1, i + 2)];

    const span = cur.end - cur.begin;
    const frac = span > 0 ? (t - cur.begin) / span : 0;
    const val = catmullRom(prev.value, cur.value, next.value, next2.value, frac, tensionVal);
    return [new Hap(undefined, state.span, val)];
  });
};

// ─── *On field operators ────────────────────────────────────────────────────
// Variants of the Strudel compose operators (add, sub, mul, div, mod, pow, set)
// that target a specific key within object values, using mix (appBoth) combining.
// e.g. pat.x(".5 .1").addOn("x", "-.5 0 .5") adds the amount pattern to the x field.

const _fieldAliases: Record<string, string> = {
  w: 'width', h: 'height', dur: 'duration', left: 'x', top: 'y',
};

const _toOps: Record<string, { op: (a: number, b: number) => number; identity: number }> = {
  set: { op: (_a, b) => b,              identity: 0 },
  add: { op: (a, b) => a + b,           identity: 0 },
  sub: { op: (a, b) => a - b,           identity: 0 },
  mul: { op: (a, b) => a * b,           identity: 1 },
  div: { op: (a, b) => a / b,           identity: 1 },
  mod: { op: (a, b) => ((a % b) + b) % b, identity: 0 },
  pow: { op: (a, b) => Math.pow(a, b),  identity: 1 },
};

/**
 * Apply an arithmetic operation to a specific named field of the value object,
 * using mix (appBoth) combining so the amount pattern's rhythm is interleaved.
 * The key itself can be a pattern, allowing the target field to vary over time.
 *
 * Available variants: `addOn`, `subOn`, `mulOn`, `divOn`, `modOn`, `powOn`, `setOn`
 *
 * **Use single quotes for literal key strings** — double-quoted strings are wrapped
 * in `mini()` by the transpiler.
 *
 * @param {string | Pattern} key field name to operate on, or pattern of field names
 * @param {number | Pattern} amount value or pattern to combine with
 * @returns {Pattern}
 * @example
 * $: s("clip.mp4").x("-.1 .1").addOn('x', "<.2 .5>")        // shift x by .2 or .5 each cycle
 * $: s("clip.mp4").x(".2").y(".3").addOn("x y", ".1")        // alternate: add to x, then y
 * $: s("clip.mp4").alpha(".5 1").mulOn('alpha', ".8 1")       // multiply alpha field
 */
for (const [name, { op, identity }] of Object.entries(_toOps)) {
  PatternProto[`${name}On`] = function (key: any, amount: any) {
    const keyPat = reify(key);
    const amountPat = reify(amount);
    const src = this;
    return new CorePattern((state: any) => {
      const srcHaps = src.query(state);
      const keyHaps = keyPat.query(state);
      const amtHaps = amountPat.query(state);
      const results: any[] = [];
      for (const sh of srcHaps) {
        for (const kh of keyHaps) {
          const kPart = sh.part.intersection(kh.part);
          if (!kPart) continue;
          const k = _fieldAliases[kh.value] ?? kh.value;
          if (typeof k !== "string") {
            warn(`${name}On: key pattern produced non-string value: ${typeof k}`);
            continue;
          }
          for (const ah of amtHaps) {
            const aPart = kPart.intersection(ah.part);
            if (!aPart) continue;
            results.push(new Hap(
              sh.whole,
              aPart,
              { ...sh.value, [k]: op(sh.value?.[k] ?? identity, ah.value) },
              sh.context,
            ));
          }
        }
      }
      return results;
    });
  };
}

/**
 * Adds `amount` to a specific named field of the pattern's value objects.
 * Uses mix (appBoth) combining, so the amount pattern's rhythm interleaves with the source.
 * The key can be a pattern to vary the target field over time.
 * Use single quotes for literal key strings — double-quoted strings are wrapped in `mini()` by the transpiler.
 * Also available as a method: `pat.addOn(key, amount)`. Related: `subOn`, `mulOn`, `divOn`, `modOn`, `powOn`, `setOn`.
 *
 * @param {Pattern} pat source pattern
 * @param {string | Pattern} key field name to add to (use single quotes: `'x'`)
 * @param {number | Pattern} amount value or pattern to add
 * @returns {Pattern}
 * @example
 * $: s("clip.mp4").x("-.1 .1").addOn('x', "<.2 .5>")   // shift x by .2 or .5 each cycle
 * $: addOn(s("clip.mp4").x("-.1 .1"), 'x', "<.2 .5>")   // function form
 * $: s("clip.mp4").x(".2").y(".3").addOn("x y", ".1")    // alternate target field
 */
export const addOn = (pat: any, key: any, amount: any) => pat.addOn(key, amount);
/** Like addOn but subtracts. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").x(".5").subOn('x', ".1 .2") */
export const subOn = (pat: any, key: any, amount: any) => pat.subOn(key, amount);
/** Like addOn but multiplies. Identity for missing keys is 1. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").alpha("1").mulOn('alpha', ".5 .8") */
export const mulOn = (pat: any, key: any, amount: any) => pat.mulOn(key, amount);
/** Like addOn but divides. Identity for missing keys is 1. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").x(".8").divOn('x', "2 4") */
export const divOn = (pat: any, key: any, amount: any) => pat.divOn(key, amount);
/** Like addOn but applies modulo. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").x("0 .3 .6 .9").modOn('x', ".5") */
export const modOn = (pat: any, key: any, amount: any) => pat.modOn(key, amount);
/** Like addOn but raises to a power. Identity for missing keys is 1. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").alpha(".5 1").powOn('alpha', "2") */
export const powOn = (pat: any, key: any, amount: any) => pat.powOn(key, amount);
/** Replaces a specific named field with the given value pattern. @param {Pattern} pat @param {string | Pattern} key @param {number | Pattern} amount @returns {Pattern} @example $: s("clip.mp4").x(".2").setOn('x', "<.5 .8>") */
export const setOn = (pat: any, key: any, amount: any) => pat.setOn(key, amount);

/**
 * Extracts a named field from the pattern's value objects, passes it as a numeric
 * Pattern to the transform function, then writes the result back into the field.
 * This lets you apply any pattern transformation (e.g. `.lerp()`, `.spline()`) to
 * a specific control already set on the pattern.
 *
 * Use single quotes for literal key strings — double-quoted strings are wrapped in
 * `mini()` by the transpiler.
 *
 * @param {string} key field name to transform (use single quotes: `'x'`)
 * @param {(pat: Pattern) => Pattern} fn transform function receiving the field as a Pattern
 * @returns {Pattern}
 * @example
 * $: s("clip.mp4").x(".1 -.1").mapOn('x', x => x.lerp())   // smooth the x field
 * $: s("clip.mp4").alpha("0 1").mapOn('alpha', a => a.spline())
 */
PatternProto.mapOn = function (key: any, fn: (p: any) => any) {
  const src = this;
  const keyPat = reify(key);
  // Build a numeric pattern from the named field by replaying each source hap's
  // field value over its part span. Using part (not whole) as the timing anchor
  // ensures distinct time steps for collectEvents when haps share a whole span.
  const fieldPat = new CorePattern((state: any) => {
    const t0 = Number(state.span.begin);
    const t1 = Number(state.span.end);
    const rawKey = keyPat.queryArc(t0, t0)[0]?.value;
    const resolvedKey = _fieldAliases[rawKey] ?? rawKey;
    if (typeof resolvedKey !== 'string') return [];
    const srcHaps = src.queryArc(t0, t1);
    return srcHaps.flatMap((hap: any) => {
      const fieldVal = hap.value?.[resolvedKey];
      if (fieldVal === undefined) return [];
      return [new Hap(hap.part, hap.part, Number(fieldVal), hap.context)];
    });
  });
  const transformed = fn(fieldPat);
  // Merge the transformed field back into the source hap values.
  // Use queryArc (not query) for both src and transformed so that patterns built
  // from mini() correctly cycle-split across absolute cycle times.
  return new CorePattern((state: any) => {
    const t0 = Number(state.span.begin);
    const t1 = Number(state.span.end);
    const rawKey2 = keyPat.queryArc(t0, t0)[0]?.value;
    const resolvedKey = _fieldAliases[rawKey2] ?? rawKey2;
    if (typeof resolvedKey !== 'string') return src.queryArc(t0, t1);
    const srcHaps = src.queryArc(t0, t1);
    const outHaps = transformed.queryArc(t0, t1);
    return srcHaps.flatMap((hap: any) => {
      if (hap.value?.[resolvedKey] === undefined) return [hap];
      const matching = outHaps.filter((oh: any) => oh.part.intersection(hap.part));
      if (!matching.length) return [hap];
      return matching.map((oh: any) => {
        const newPart = oh.part.intersection(hap.part);
        if (!newPart) return null;
        return new Hap(
          hap.whole,
          newPart,
          { ...(typeof hap.value === 'object' && hap.value !== null ? hap.value : {}), [resolvedKey]: oh.value },
          hap.context,
        );
      }).filter(Boolean);
    });
  });
};

/**
 * Extracts a named field from the pattern's value objects, passes it as a numeric
 * Pattern to the transform function, then writes the result back.
 * Function form of the `.mapOn()` method.
 *
 * @param {Pattern} pat source pattern
 * @param {string} key field name to transform (use single quotes: `'x'`)
 * @param {(pat: Pattern) => Pattern} fn transform function
 * @returns {Pattern}
 * @example
 * $: mapOn(s("clip.mp4").x(".1 -.1"), 'x', x => x.lerp())
 */
export const mapOn = (pat: any, key: string, fn: (p: any) => any) => pat.mapOn(key, fn);
