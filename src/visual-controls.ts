/**
 * Visual controls registered on Pattern.prototype via createMixParam.
 *
 * createMixParam uses a custom combiner that queries both patterns at frame time
 * (so signals animate smoothly) while preserving the source pattern's whole span
 * (so fit/chop/loopAt see the true event duration). See docs/combinators.md.
 */
import { reify, Pattern, Hap } from "@strudel/core";
import { createMixParam } from "./create-mix-param";
import "./pattern-extensions"; // registers addOn on Pattern.prototype
import { resolveMedia } from "./media-registry";
import { resolveValue } from "./resolve-pattern-value";
import { getRuntimeCps } from "./config";
import { warn } from "./warnings";
import { nextLayoutParent } from "./layout-counter";

const PatternProto = Pattern.prototype as any;

/**
 * Sets the transparency of the pattern. 0 = fully transparent, 1 = fully opaque.
 *
 * @param {number | string | Pattern} value alpha value or pattern of alpha values (0–1)
 * @returns {Pattern} pattern with alpha applied
 * @example
 * $: video("clip.mp4").alpha(0.5)
 * $: color("red").alpha("1 0.5 0")        // patterned alpha
 * $: video("clip.mp4").alpha(sine)         // pulsing transparency
 *
 */
export const alpha = createMixParam("alpha");

/**
 * Alias for alpha. Sets the transparency of the pattern.
 *
 * @param {number | string | Pattern} value opacity value (0–1)
 * @returns {Pattern} pattern with opacity applied
 * @example
 * $: video("clip.mp4").opacity(0.5)
 *
 */
export const opacity = createMixParam("opacity");

/**
 * Rotates the pattern around the Z axis (standard 2D rotation). Value is in turns (0–1).
 *
 * @param {number | string | Pattern} value rotation in turns (0.25 = 90°, 0.5 = 180°)
 * @returns {Pattern} pattern with Z rotation applied
 * @example
 * $: video("clip.mp4").rotateZ(0.25)          // 90° clockwise
 * $: video("clip.mp4").rotateZ(sine)          // continuous rotation
 *
 */
export const rotateZ = createMixParam("rotateZ");

/**
 * Rotates the pattern around the X axis (horizontal axis — tilts forward/back).
 * Value is in turns (0–1). Rendered as orthographic projection (Y-axis scaling).
 *
 * @param {number | string | Pattern} value rotation in turns
 * @returns {Pattern} pattern with X rotation applied
 * @example
 * $: video("clip.mp4").rotateX(0.25)          // flipped vertically
 * $: color("red").rotateX(sine)               // pulsing tilt
 *
 */
export const rotateX = createMixParam("rotateX");

/**
 * Rotates the pattern around the Y axis (vertical axis — tilts left/right).
 * Value is in turns (0–1). Rendered as orthographic projection (X-axis scaling).
 *
 * @param {number | string | Pattern} value rotation in turns
 * @returns {Pattern} pattern with Y rotation applied
 * @example
 * $: video("clip.mp4").rotateY(0.25)          // flipped horizontally
 *
 */
export const rotateY = createMixParam("rotateY");

const rotateParam = createMixParam("rotate");
const rotateAxisParam = createMixParam("rotateAxis");

/**
 * Rotates the pattern. Without axis: standard 2D rotation (same as .rotateZ()).
 * With axis: rotates around an axis in the 2D plane, specified in turns
 * (0 = horizontal/X axis, 0.25 = vertical/Y axis).
 *
 * @param {number | string | Pattern} turns rotation amount in turns
 * @param {number | string | Pattern} [axis] axis angle in turns (omit for Z rotation)
 * @returns {Pattern} pattern with rotation applied
 * @example
 * $: video("clip.mp4").rotate(0.25)           // 90° 2D rotation
 * $: video("clip.mp4").rotate(0.25, 0)        // rotate around horizontal axis
 * $: video("clip.mp4").rotate(sine, 0.25)     // rotate around vertical axis
 *
 */
PatternProto.rotate = function (turns: any, axis?: any) {
  if (axis === undefined) {
    return this.rotateZ(turns);
  }
  return rotateAxisParam(axis, rotateParam(turns, this));
};

/**
 * Scales the pattern horizontally. 1 = normal, 2 = double width, 0.5 = half width.
 *
 * @param {number | string | Pattern} value horizontal scale factor
 * @returns {Pattern} pattern with horizontal scale applied
 * @example
 * $: video("clip.mp4").scaleX(2)           // stretched horizontally
 * $: video("clip.mp4").scaleX("1 0.5")     // alternating scale
 *
 */
export const scaleX = createMixParam("scaleX");

/**
 * Scales the pattern vertically. 1 = normal, 2 = double height, 0.5 = half height.
 *
 * @param {number | string | Pattern} value vertical scale factor
 * @returns {Pattern} pattern with vertical scale applied
 * @example
 * $: video("clip.mp4").scaleY(0.5)         // squashed vertically
 *
 */
export const scaleY = createMixParam("scaleY");

/**
 * Controls how video/image content fits within its cell. Options: "cover" (default), "contain", "fill", "none".
 *
 * @param {string | Pattern} value fit mode: "cover" fills cell (crops), "contain" fits inside (may letterbox),
 *   "fill" stretches to fill (may distort), "none" draws at native resolution
 * @returns {Pattern} pattern with fit mode applied
 * @example
 * $: video("clip.mp4").objectfit("contain")
 * $: video("clip.mp4").objectfit("cover contain")  // alternates per cycle
 *
 */
export const objectfit = createMixParam("objectfit");

/**
 * Sets the CSS blend mode for compositing this pattern onto the canvas.
 * Uses canvas globalCompositeOperation values (same as CSS mix-blend-mode).
 *
 * @param {string | Pattern} value blend mode: "multiply", "screen", "overlay", "darken", "lighten",
 *   "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion",
 *   "hue", "saturation", "color", "luminosity", "source-over" (default)
 * @returns {Pattern} pattern with blend mode applied
 * @example
 * $: video("clip.mp4").blend("multiply")
 * $: color("red").blend("screen difference")  // alternates per cycle
 *
 */
export const blend = createMixParam("blend");

/**
 * Scales the pattern uniformly on both axes. Shorthand for .scaleX(v).scaleY(v).
 *
 * @param {number | string | Pattern} value scale factor for both axes
 * @returns {Pattern} pattern with uniform scale applied
 * @example
 * $: video("clip.mp4").scale(0.5)          // half size
 * $: video("clip.mp4").scale("0.5 1 1.5")  // patterned scale
 *
 */
PatternProto.scale = function (value: any) {
  return this.scaleX(value).scaleY(value);
};

/**
 * Sets the playback speed of a video. 1 = normal, 2 = double, -1 = reverse.
 * Negative speeds and extreme values use manual seeking.
 *
 * @param {number | string | Pattern} value playback rate
 * @returns {Pattern} pattern with speed applied
 * @example
 * $: video("clip.mp4").speed(2)            // double speed
 * $: video("clip.mp4").speed(-1)           // reverse playback
 * $: video("clip.mp4").speed("1 2 -1")    // patterned speed
 *
 */
export const speed = createMixParam("speed");

/**
 * Enables continuous playback, ignoring event boundaries. Without sync(), a
 * video restarts each cycle. With sync(), it plays continuously from cycle 0.
 *
 * An optional phase offset (0–1, fraction of video duration) shifts the
 * playback start point within the video.
 *
 * @param {number | string | Pattern} [value] phase offset as fraction of video duration (default: true = no offset)
 * @returns {Pattern} pattern with sync enabled
 * @example
 * $: video("clip.mp4").sync()              // plays freely from cycle 0
 * $: video("clip.mp4").sync(0.5)           // plays from 50% into the video
 * $: video("clip.mp4").sync(0.3).begin(0.5) // phase-shifted, looping in 50-100% range
 *
 */
export const sync = createMixParam("sync");
PatternProto.sync = function (value?: any) {
  if (value === undefined) value = true;
  return sync(value, this);
};

export const rolling = createMixParam("rolling");
/**
 * Enables continuous playback where position is preserved across re-evals and speed changes.
 * Unlike sync(), position is not reset to a clock-synchronized value — the video continues
 * from wherever it was. Speed=0 freezes in place; resuming continues from the frozen position.
 *
 * Combined with sync(): rolling takes precedence for an existing video element;
 * sync initializes a fresh element to the clock-synchronized position.
 *
 * @returns {Pattern} pattern with rolling enabled
 * @example
 * $: video("clip.mp4").rolling()              // plays continuously, position preserved across re-evals
 * $: video("clip.mp4").speed("0 1").rolling() // freeze half-cycle, advance half-cycle, repeat
 * $: video("clip.mp4").speed("-1 0").rolling() // reverse then freeze in place
 * $: video("clip.mp4").speed(sine).rolling()  // smooth speed modulation, never resets
 */
PatternProto.rolling = function (value?: any) {
  if (value === undefined) value = true;
  return rolling(value, this);
};

/**
 * Sets the start position within a video (0–1, where 0 = beginning, 1 = end).
 * Uses Strudel's `begin` property, so it composes with .chop(), .slice(), etc.
 *
 * @param {number | string | Pattern} value start position (0–1)
 * @returns {Pattern} pattern with begin position applied
 * @example
 * $: video("clip.mp4").begin(0.5)          // start halfway through
 * $: video("clip.mp4").begin(0.2).end(0.8).chop(4)  // chop middle 60% into 4 slices
 *
 */
export const begin = createMixParam("begin");

/**
 * Sets the end position within a video (0–1, where 1 = end of video).
 * Uses Strudel's `end` property, so it composes with .chop(), .slice(), etc.
 *
 * @param {number | string | Pattern} value end position (0–1)
 * @returns {Pattern} pattern with end position applied
 * @example
 * $: video("clip.mp4").begin(0.25).end(0.75) // play middle 50%
 *
 */
export const end = createMixParam("end");

/**
 * Sets the duration of video playback relative to begin position (0–1).
 * Computes end = begin + value. Alias: .dur()
 *
 * @param {number | string | Pattern} value duration as fraction of video length
 * @returns {Pattern} pattern with end computed from begin + duration
 * @example
 * $: video("clip.mp4").begin(0).duration(0.25)  // play first quarter
 * $: video("clip.mp4").dur(0.1)                 // short snippet
 *
 */
PatternProto.duration = function (value: any) {
  const p = reify(value).withValue((v: any) => ({ _dur: v }));
  const merged = this.set(p);
  return new Pattern((state: any) => {
    return merged.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      return hap.withValue((v: any) => {
        if (v._dur != null) {
          const b = v.begin ?? 0;
          const { _dur, ...rest } = v;
          const rawEnd = b + Number(_dur);
          const end = rawEnd >= 0 && rawEnd <= 1 ? rawEnd : ((rawEnd % 1) + 1) % 1;
          return { ...rest, end };
        }
        return v;
      });
    });
  });
};
PatternProto.dur = PatternProto.duration;

/**
 * Freezes the video at a given position within the existing begin/end range.
 * With no prior begin/end, scrub(0.5) freezes at the midpoint of the full video.
 * After .begin(0.2).end(0.8), scrub(0.5) freezes at the midpoint of that region (0.5).
 * After .chop(8), scrub(sine) scans within each slice's region.
 *
 * @param {number | string | Pattern} value position within current range (0–1)
 * @returns {Pattern} pattern frozen at the interpolated position
 * @example
 * $: video("clip.mp4").scrub(0.5)                    // freeze at halfway
 * $: video("clip.mp4").scrub(sine)                   // slowly scan through
 * $: video("clip.mp4").begin(0.2).end(0.8).scrub(0.5) // freeze at 0.5 (midpoint of region)
 * $: video("clip.mp4").chop(8).scrub(sine)           // scan within each slice
 *
 */
PatternProto.scrub = function (value: any) {
  const pat = this;
  const valPat = reify(value);
  // Frame-time combiner: query the signal at current state (not at the event's
  // whole span) so signals like sine animate smoothly every frame.
  return new Pattern((state: any) => {
    const mainHaps = pat.queryArc(state.span.begin, state.span.end);
    const ctrlHaps = valPat.queryArc(state.span.begin, state.span.end);
    const scrubVal = ctrlHaps.length > 0 ? Number(ctrlHaps[0].value) : 0;
    return mainHaps.map((hap: any) => {
      return hap.withValue((v: any) => {
        const b = v.begin ?? 0;
        const e = v.end ?? 1;
        const pos = b + scrubVal * (e - b);
        // Wrap within full video [0, 1], not within [b, e] —
        // so scrubbing past a chop slice or begin/end region
        // reaches other parts of the video rather than looping in place.
        const wrapped = pos >= 0 && pos <= 1 ? pos : ((pos % 1) + 1) % 1;
        return { ...v, begin: wrapped, end: wrapped };
      });
    });
  });
};

/**
 * Adjusts speed so the video (or the begin..end slice) fills exactly the event's duration.
 * Good for rhythmical loops — the video plays once per event, regardless of event length.
 *
 * Requires video duration to be known (stored in media registry after first load).
 * If duration is unknown, plays at speed 1.
 *
 * @returns {Pattern} pattern with speed adjusted to fill event duration
 * @example
 * $: s("clip.mp4").fit()                         // video fills one cycle
 * $: s("clip.mp4").slow(4).fit()                 // video fills 4 cycles
 * $: s("clip.mp4").begin(0.25).end(0.75).fit()   // middle 50% fills the event
 *
 */
PatternProto.fit = function (...args: any[]) {
  if (args.length > 0) {
    warn('fit() no longer sets object-fit mode — use .objectfit("contain") instead. fit() with no args adjusts speed to fill the event duration (like Strudel).');
  }
  const pat = this;
  return new Pattern((state: any) => {
    return pat.queryArc(state.span.begin, state.span.end).map((hap: any) => {
      if (!hap.value || !hap.whole) return hap;
      const v = hap.value;
      const src = v.src;
      if (!src) return hap;
      const entry = resolveMedia(src);
      const dur = entry?.duration;
      if (!dur) return hap;
      const cps = getRuntimeCps();
      // createMixParam preserves source whole, so hap.whole is never clipped
      const hapDur = Number(hap.whole.end) - Number(hap.whole.begin);
      if (hapDur <= 0) return hap;
      const sliceDur = (v.end ?? 1) - (v.begin ?? 0);
      const speed = sliceDur * dur * cps / hapDur;
      return hap.withValue((val: any) => ({ ...val, speed }));
    });
  });
};

/**
 * Makes a video fit into the given number of cycles by adjusting speed and slowing the pattern.
 * The video plays once over `n` cycles.
 *
 * Requires video duration to be known (stored in media registry after first load).
 * If duration is unknown, still slows the pattern but leaves speed at 1.
 *
 * @param {number | string | Pattern} n number of cycles the video should span
 * @returns {Pattern} pattern slowed by n with speed adjusted
 * @example
 * $: s("clip.mp4").loopAt(4)                     // video spans 4 cycles
 * $: s("clip.mp4 clip2.mp4").loopAt(2)           // each video spans 2 cycles
 * $: s("clip.mp4").begin(0.5).end(1).loopAt(4)   // second half spans 4 cycles
 *
 */
PatternProto.loopAt = function (n: any) {
  const pat = this;
  return new Pattern((state: any) => {
    const nVal = Number(reify(n).queryArc(state.span.begin, state.span.begin)[0]?.value ?? 1);
    return pat.slow(nVal).queryArc(state.span.begin, state.span.end).map((hap: any) => {
      if (!hap.value || !hap.whole) return hap;
      const v = hap.value;
      const src = v.src;
      if (!src) return hap;
      const entry = resolveMedia(src);
      const dur = entry?.duration;
      if (!dur) return hap;
      const cps = getRuntimeCps();
      const sliceDur = (v.end ?? 1) - (v.begin ?? 0);
      const speed = sliceDur * dur * cps / nVal;
      return hap.withValue((val: any) => ({ ...val, speed }));
    });
  });
};
PatternProto.loopat = PatternProto.loopAt;

/**
 * Sets the base URL for loading video/image files. Use single quotes to avoid mininotation parsing.
 *
 * @param {string | Pattern} value base URL string
 * @returns {Pattern} pattern with custom URL base
 * @example
 * $: video("clip.mp4").urlBase('http://other-server/videos/')
 *
 */
export const urlBase = createMixParam("urlBase");

/**
 * Shifts the horizontal position of the pattern (additive — 0 by default, so top-level
 * `.x(0.5)` still places at x=0.5). Additive behaviour lets nested grids be shifted
 * as a unit: `inner.gridMod().x(0.1)` shifts the whole inner group within its outer cell.
 *
 * @param {number | string | Pattern} value x offset
 * @returns {Pattern} pattern with x offset applied
 * @example
 * $: color("red").x(0.5).width(0.5)       // right half of screen
 * $: video("clip.mp4").x(sine).width(0.5)  // slides left to right
 * $: stack(color("cyan"), color("magenta")).index().rowscols(2).gridMod().x(0.1)
 *    // shift inner group 0.1 units right within its outer cell
 *
 */
// x and y are additive (use addOn / appBoth) rather than replacement (createMixParam / appLeft).
// This lets .x(v) shift position relative to whatever the current x is — so nested grids
// composed by gridMod() can be shifted as a unit: inner.gridMod().x(0.1) shifts the whole
// inner group within its outer cell, rather than jumping to an absolute position.
// Top-level usage is unchanged: 0 (default) + v = v.
//
// Exception: _perEvent controls (rand, irand, choose) use appLeft instead of appBoth.
// appBoth samples the control at frame time (flickering rand values), whereas appLeft
// samples at the hap's onset — giving stable per-event random values. The additive
// merge is still applied; only the combining strategy differs.
function makeXY(field: 'x' | 'y') {
  const method = function (this: any, value: any) {
    const valPat = reify(value);
    if ((valPat as any)._perEvent) {
      return this.fmap((v: any) => (ctrl: any) => {
        const base = typeof v === 'object' && v !== null ? v : {};
        return { ...base, [field]: (base[field] ?? 0) + ctrl };
      }).appLeft(valPat);
    }
    return this.addOn(field, value);
  };
  (PatternProto as any)[field] = method;
}
makeXY('x');
makeXY('y');

export const x = function (value: any, pat?: any) {
  if (!pat) return reify(value).withValue((v: any) => ({ x: v }));
  return (pat as any).x(value);
};
PatternProto.left = PatternProto.x;

/**
 * Shifts the vertical position of the pattern (additive — 0 by default, so top-level
 * `.y(0.5)` still places at y=0.5). Additive behaviour lets nested grids be shifted
 * as a unit: `inner.gridMod().y(0.1)` shifts the whole inner group within its outer cell.
 *
 * @param {number | string | Pattern} value y offset
 * @returns {Pattern} pattern with y offset applied
 * @example
 * $: color("red").y(0.5).height(0.5)       // bottom half of screen
 *
 */
export const y = function (value: any, pat?: any) {
  if (!pat) return reify(value).withValue((v: any) => ({ y: v }));
  return (pat as any).y(value);
};
PatternProto.top = PatternProto.y;

/**
 * Sets the width of the pattern (0–1, where 1 = full canvas width).
 *
 * @param {number | string | Pattern} value width
 * @returns {Pattern} pattern with width applied
 * @example
 * $: video("clip.mp4").width(0.5)          // half width
 * $: video("clip.mp4").width("0.5 1")      // alternates half/full
 *
 */
export const width = createMixParam("width");
PatternProto.w = PatternProto.width;

/**
 * Sets the height of the pattern (0–1, where 1 = full canvas height).
 *
 * @param {number | string | Pattern} value height
 * @returns {Pattern} pattern with height applied
 * @example
 * $: video("clip.mp4").height(0.5)         // half height
 *
 */
export const height = createMixParam("height");
PatternProto.h = PatternProto.height;

// Custom implementation: .i() also sets count=Infinity when count isn't already
// present, so that gridMod/circleMod place the element in exactly one cell by default.
// Using index()/stackN() always sets count explicitly, so this only affects manual .i() usage.
const iFunc = function (value: any, pat?: any) {
  if (!pat) return reify(value).withValue((v: any) => ({ i: v, count: Infinity, layoutParent: undefined }));
  if (value === undefined) return pat.fmap((v: any) => ({ i: v, count: Infinity, layoutParent: undefined }));
  const valPat = reify(value);

  if ((valPat as any)._perEvent) {
    return pat.fmap((v: any) => (ctrl: any) => {
      const base = typeof v === 'object' && v !== null ? v : {};
      return { ...(base.count === undefined ? { count: Infinity } : {}), ...base, i: ctrl, layoutParent: undefined };
    }).appLeft(valPat);
  }

  return new Pattern((state: any) => {
    const mainHaps = pat.query(state);
    return mainHaps.flatMap((hap: any) => {
      const ctrlHaps = valPat.query(state);
      if (!ctrlHaps.length) return [hap];

      const results: any[] = [];
      for (const ch of ctrlHaps) {
        const newPart = hap.part.intersection(ch.part);
        if (!newPart) continue;
        const base = typeof hap.value === 'object' && hap.value !== null ? hap.value : {};
        results.push(new Hap(
          hap.whole,
          newPart,
          { ...(base.count === undefined ? { count: Infinity } : {}), ...base, i: ch.value, layoutParent: undefined },
          hap.context
        ));
      }
      return results.length ? results : [hap];
    });
  });
};

/**
 * Sets the cell index for grid/circle placement (0-based). Read by .grid(), .gridMod(), .circle(), .circleMod().
 * Set automatically by index() and indexCycle(). When used manually, defaults count to Infinity
 * so gridMod/circleMod place the element in exactly one cell. Override with .count(n) for striding.
 *
 * @param {number | string | Pattern} value cell index (0-based)
 * @example
 * $: video("clip.mp4").i(2).rows(2).cols(2).grid()
 * $: index(color("red"), color("blue")).rowscols(2).gridMod()
 * $: s("red").i(3).rowscols(4).gridMod()
 */
PatternProto.i = function (value: any) {
  return iFunc(value, this);
};
export { iFunc as i };

/**
 * Sets the stride — number of patterns sharing the grid. Used by .gridMod() and .circleMod()
 * to determine occupied cells: i, i+count, i+2*count, etc. Set automatically by index().
 *
 * @param {number | string | Pattern} value stride
 * @example
 * $: stack(color("red").i(0).count(2), color("blue").i(1).count(2)).rowscols(2).gridMod()
 */
export const count = createMixParam("count");

/**
 * Sets the number of rows in the grid. Read by .grid() and .gridMod() when no rows arg is passed.
 *
 * @param {number | string | Pattern} value number of rows
 * @example
 * $: video("clip.mp4").i(0).rows(2).cols(2).grid()
 */
export const rows = createMixParam("rows");

/**
 * Sets the number of columns in the grid. Read by .grid() and .gridMod() when no cols arg is passed.
 *
 * @param {number | string | Pattern} value number of columns
 * @example
 * $: video("clip.mp4").i(1).rows(2).cols(2).grid()
 */
export const cols = createMixParam("cols");

/**
 * Sets the circle radius in screen coordinates (0–0.5). Read by .circle() and .circleMod().
 *
 * @param {number | string | Pattern} value radius (0–0.5)
 * @example
 * $: index(video("a.mp4"), video("b.mp4")).circleCount(4).radius(0.35).circle()
 */
export const radius = createMixParam("radius");

/**
 * Sets the circle rotation start offset in turns (0=top, 0.25=right, 0.5=bottom). Read by .circle() and .circleMod().
 *
 * @param {number | string | Pattern} value rotation offset (0–1 turns)
 * @example
 * $: video("clip.mp4").i(0).circleCount(4).startOffset(0.25).circle(0.35)
 */
export const startOffset = createMixParam("startOffset");

/**
 * Sets the total number of slots in the circle. Read by .circle() and .circleMod().
 *
 * @param {number | string | Pattern} value total slot count
 * @example
 * $: index(video("a.mp4"), video("b.mp4")).circleCount(4).circle(0.35)
 */
export const circleCount = createMixParam("circleCount");

/**
 * Sets both rows and cols to the same value. Shorthand for .rows(n).cols(n).
 *
 * @param {number | string | Pattern} value number of rows and columns
 * @example
 * $: index(color("red"), color("blue")).rowscols(2).gridMod()
 * $: video("clip.mp4").i(0).rowscols("2 3").grid()
 */
PatternProto.rowscols = function (value: any) {
  return this.rows(value).cols(value);
};

// Helper: compute {x, y, width, height} for cell index i in a cols×rows grid
function cellPos(i: number, cols: number, rows: number) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows };
}

// Convenience wrappers for resolveValue
function resolveNum(val: any, begin: any): number {
  return Math.round(resolveValue(val, begin));
}

function resolveFloat(val: any, begin: any): number {
  return resolveValue(val, begin);
}

// Compose a new grid cell position with any existing position on the event value.
// "outer" = new grid cell, "inner" = existing position from prior .grid() calls.
// finalX = outer.x + inner.x * outer.width, etc.
function composePos(value: any, outer: { x: number; y: number; width: number; height: number }) {
  const ix = value.x ?? 0;
  const iy = value.y ?? 0;
  const iw = value.width ?? 1;
  const ih = value.height ?? 1;
  return {
    ...value,
    x: outer.x + ix * outer.width,
    y: outer.y + iy * outer.height,
    width: iw * outer.width,
    height: ih * outer.height,
  };
}

/**
 * Positions the pattern in one or more cells of a cols×rows grid. All arguments can be patterns.
 * Composes with existing position from prior .grid() calls, enabling grid-of-grids nesting.
 *
 * @param {number | Pattern} rowsArg number of rows (optional, reads from .rows() value if omitted)
 * @param {number | Pattern} colsArg number of columns (optional, reads from .cols() value if omitted; defaults to 1 if only rows given)
 * @param {number | Pattern} iArg cell index (optional, reads from .i() value if omitted)
 * @returns {Pattern} pattern positioned in the grid cell(s)
 * @example
 * $: video("clip.mp4").grid(0, 2, 2)           // top-left of 2×2
 * $: video("clip.mp4").grid(3, 2, 2)           // bottom-right of 2×2
 * $: video("clip.mp4").grid("0 1 2 3", 2, 2)   // cycles through cells
 * $: video("clip.mp4").grid("0,1,2,3", 2, 2)   // all 4 cells at once
 * $: color("red").grid(0, 2, 1).grid(0, 1, 2)  // nested grids
 *
 */
PatternProto.grid = function (rowsArg?: any, colsArg?: any, iArg?: any) {
  const self = this;
  const layoutParent = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;

    if (iArg !== undefined) {
      // iArg provided: iterate its events (supports mini("0,3") for simultaneous cells)
      const iEvents = reify(iArg).queryArc(begin, end);
      const results: any[] = [];
      for (const iEv of iEvents) {
        const iVal = Math.round(Number(iEv.value));
        const positioned = self.withValue((v: any) => {
          const val = Object(v) === v ? v : {};
          const r = rowsArg !== undefined ? resolveNum(rowsArg, begin) : (val.rows ?? 2);
          const c = colsArg !== undefined ? resolveNum(colsArg, begin) : rowsArg !== undefined ? 1 : (val.cols ?? 2);
          return { ...composePos(val, cellPos(iVal, c, r)), layoutParent };
        });
        results.push(...positioned.queryArc(begin, end));
      }
      return results;
    }

    // No iArg: read i from each event's value
    return self.withValue((v: any) => {
      const val = Object(v) === v ? v : {};
      const r = rowsArg !== undefined ? resolveNum(rowsArg, begin) : (val.rows ?? 2);
      const c = colsArg !== undefined ? resolveNum(colsArg, begin) : rowsArg !== undefined ? 1 : (val.cols ?? 2);
      const iVal = val.i ?? 0;
      return { ...composePos(val, cellPos(iVal, c, r)), layoutParent };
    }).queryArc(begin, end);
  });
};

/**
 * Assigns grid cells to a child pattern by cycling through cells with a stride. Used by index()
 * to distribute children across a grid. All arguments can be patterns, resolved at query time.
 *
 * @param {number | Pattern} childIndex this child's index in the list of children
 * @param {number | Pattern} numChildren total number of children (determines stride)
 * @param {number | Pattern} cols number of columns
 * @param {number | Pattern} rows number of rows
 * @returns {Pattern} pattern positioned in its assigned grid cells
 * @example
 * // In a 2×2 grid with 2 children, child 0 gets cells 0,2 and child 1 gets cells 1,3
 * index(video("a.mp4"), video("b.mp4")).rowscols(2).gridMod()
 *
 */
/**
 * Like .grid() but cycles this pattern across multiple cells based on i, count, cols, rows.
 * All args optional — reads from event values (.i(), .count(), .rows(), .cols()) if not provided.
 *
 * Stamps a unique `layoutParent` token on all output events so that outer index() calls
 * treat all events from this gridMod as a single logical slot — enabling nested grids.
 *
 * @param {number | Pattern} rowsArg number of rows (optional)
 * @param {number | Pattern} colsArg number of columns (optional)
 * @example
 * $: stack(video("a.mp4"), video("b.mp4")).index().rowscols(2).gridMod()
 * $: stack(
 *      stack(color("cyan"), color("magenta")).index().rowscols(2).gridMod(),
 *      color("red")
 *    ).index().rowscols(2).gridMod()   // nested 2×2 inside outer 2×2
 */
PatternProto.gridMod = function (rowsArg?: any, colsArg?: any) {
  const self = this;
  const layoutParent = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const selfEvs = self.queryArc(begin, end);
    if (selfEvs.length === 0) return [];

    const results: any[] = [];
    for (const ev of selfEvs) {
      const val = Object(ev.value) === ev.value ? ev.value : {};
      const r = rowsArg !== undefined ? resolveNum(rowsArg, begin) : (val.rows ?? 2);
      const c = colsArg !== undefined ? resolveNum(colsArg, begin) : (val.cols ?? 2);
      const ci = val.i ?? 0;
      const nc = val.count ?? 1;
      const totalCells = r * c;
      for (let idx = ci; idx < totalCells; idx += nc) {
        const pos = cellPos(idx, c, r);
        results.push(ev.withValue(() => ({ ...composePos(val, pos), layoutParent })));
      }
    }
    return results;
  });
};

// ─── tile ─────────────────────────────────────────────────────────────────────

/**
 * Compute tile cell position for element i out of count total.
 * rows = round(sqrt(count)); front-loaded rows get one extra element.
 * e.g. count=7 → rows=3, row sizes: [3, 2, 2]
 */
function tileCellPos(i: number, count: number): { x: number; y: number; width: number; height: number } {
  const n = Math.max(1, count);
  const rows = Math.max(1, Math.round(Math.sqrt(n)));
  const rowHeight = 1 / rows;
  const extra = n % rows; // first `extra` rows have one more element
  // find which row element i is in
  let row = 0;
  let remaining = i;
  for (let r = 0; r < rows; r++) {
    const rowSize = Math.floor(n / rows) + (r < extra ? 1 : 0);
    if (remaining < rowSize) { row = r; break; }
    remaining -= rowSize;
  }
  const rowSize = Math.floor(n / rows) + (row < extra ? 1 : 0);
  const col = remaining;
  return { x: col / rowSize, y: row * rowHeight, width: 1 / rowSize, height: rowHeight };
}

/**
 * Places each stacked pattern element in its own cell, automatically computing
 * a layout based on the number of elements. The number of rows is
 * `Math.round(Math.sqrt(N))`, and elements are distributed front-loaded across rows
 * (e.g. 7 elements → rows of 3, 2, 2).
 *
 * @returns {Pattern} pattern with each element positioned in its tile cell
 * @example
 * $: stack(color("red"), color("blue"), color("green")).tile()
 * $: stack(video("a.mp4"), video("b.mp4"), video("c.mp4"), video("d.mp4")).tile()
 */
PatternProto.tile = function () {
  const self = this;
  const layoutParent = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    return self.withValue((v: any) => {
      const val = Object(v) === v ? v : {};
      const i = val.i ?? 0;
      const count = val.count ?? 1;
      return { ...composePos(val, tileCellPos(i, count)), layoutParent };
    }).queryArc(begin, end);
  });
};

// ─── circle / circleMod ───────────────────────────────────────────────────────

function circlePos(i: number, count: number, radius: number, startOffset: number, w: number, h: number) {
  const angle = Math.PI * 2 * (i / count + startOffset) - Math.PI / 2;
  const cx = 0.5 + radius * Math.cos(angle);
  const cy = 0.5 + radius * Math.sin(angle);
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

function circleElementSize(n: number, r: number): number {
  return 2 * r * Math.sin(Math.PI / Math.max(n, 2));
}

/**
 * Positions a pattern centered on a point along a circle.
 * @param radiusArg radius in screen coords (0–0.5); falls back to event radius (default 0.3)
 * @param startOffsetArg rotation offset 0–1 turns, 0=top; falls back to event startOffset
 * @param circleCountArg total elements in circle; falls back to event circleCount
 * @param iArg which slot; falls back to event i
 */
PatternProto.circle = function (radiusArg?: any, startOffsetArg?: any, circleCountArg?: any, iArg?: any) {
  const self = this;
  const layoutParent = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    return self.withValue((v: any) => {
      const val = Object(v) === v ? v : {};
      const r = radiusArg !== undefined ? resolveFloat(radiusArg, begin) : (val.radius ?? 0.3);
      const so = startOffsetArg !== undefined ? resolveFloat(startOffsetArg, begin) : (val.startOffset ?? 0);
      const n = circleCountArg !== undefined ? resolveNum(circleCountArg, begin) : (val.circleCount ?? val.count ?? 1);
      const i = iArg !== undefined ? resolveNum(iArg, begin) : (val.i ?? 0);
      const size = circleElementSize(n, r);
      const w = val.width ?? size;
      const h = val.height ?? size;
      const pos = circlePos(i, n, r, so, w, h);
      return { ...val, ...pos, layoutParent };
    }).queryArc(begin, end);
  });
};

/**
 * Places a pattern across multiple circle positions using count as stride.
 * Element appears at slots i, i+count, i+2*count, ... up to circleCount.
 * @param radiusArg radius; falls back to event radius (default 0.3)
 * @param startOffsetArg rotation offset; falls back to event startOffset
 * @param circleCountArg total slots; falls back to event circleCount
 */
PatternProto.circleMod = function (radiusArg?: any, startOffsetArg?: any, circleCountArg?: any) {
  const self = this;
  const layoutParent = nextLayoutParent();
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const selfEvs = self.queryArc(begin, end);
    if (selfEvs.length === 0) return [];
    const results: any[] = [];
    for (const ev of selfEvs) {
      const val = Object(ev.value) === ev.value ? ev.value : {};
      const r = radiusArg !== undefined ? resolveFloat(radiusArg, begin) : (val.radius ?? 0.3);
      const so = startOffsetArg !== undefined ? resolveFloat(startOffsetArg, begin) : (val.startOffset ?? 0);
      const ci = val.i ?? 0;
      const nc = val.count ?? 1;
      const total = circleCountArg !== undefined ? resolveNum(circleCountArg, begin) : (val.circleCount ?? nc);
      const size = circleElementSize(total, r);
      const w = val.width ?? size;
      const h = val.height ?? size;
      for (let idx = ci; idx < total; idx += nc) {
        const pos = circlePos(idx, total, r, so, w, h);
        results.push(ev.withValue(() => ({ ...val, ...pos, layoutParent })));
      }
    }
    return results;
  });
};

/**
 * For each hap, calls fn(pat, value) where pat is a pure pattern of the hap's
 * value and value is the raw hap value. Returns the result pattern's values.
 *
 * @example
 * // Set radius dynamically from event's i value:
 * index(color("red"), color("blue")).mapWithVal((p, v) => p.radius(v.i * 0.1 + 0.1))
 */
PatternProto.mapWithVal = function (fn: (pat: any, value: any) => any) {
  const self = this;
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const evs = self.queryArc(begin, end);
    return evs.flatMap((ev: any) => {
      const transformed = fn(reify(ev.value), ev.value);
      return transformed.queryArc(begin, end).map((te: any) =>
        ev.withValue(() => te.value)
      );
    });
  });
};

