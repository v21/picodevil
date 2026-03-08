/**
 * Visual controls registered on Pattern.prototype via set.mix (appBoth).
 *
 * Unlike Strudel's default set.in (appLeft), set.mix queries both patterns
 * at the original query state (frame time), so continuous signals like sine
 * get sampled at the exact frame time rather than the event's onset.
 */
import { reify, Pattern } from "@strudel/core";

const PatternProto = Pattern.prototype as any;

function createMixParam(name: string) {
  const withVal = (v: any) => ({ [name]: v });

  const func = function (value: any, pat?: any) {
    if (!pat) return reify(value).withValue(withVal);
    if (value === undefined) return pat.fmap(withVal);
    return pat.set.mix(reify(value).withValue(withVal));
  };

  PatternProto[name] = function (value: any) {
    return func(value, this);
  };

  return func;
}

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
 * $: video("clip.mp4").fit("contain")
 * $: video("clip.mp4").fit("cover contain")  // alternates per cycle
 *
 */
export const fit = createMixParam("fit");

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
 * Sets the start position within a video. Values are relative to duration by default (0–1).
 * Use .sec() or .ms() on the value pattern for absolute times.
 *
 * @param {number | string | Pattern} value start position (0–1 relative, or with .sec()/.ms())
 * @returns {Pattern} pattern with start position applied
 * @example
 * $: video("clip.mp4").start(0.5)          // start halfway through
 * $: video("clip.mp4").start(mini("5").sec()) // start at 5 seconds
 *
 */
export const start = createMixParam("start");

/**
 * Sets the end position within a video (absolute, not relative to start).
 * Values are relative to duration by default (0–1). Use .sec() or .ms() for absolute times.
 *
 * @param {number | string | Pattern} value end position
 * @returns {Pattern} pattern with end position applied
 * @example
 * $: video("clip.mp4").start(0.25).end(0.75) // play middle 50%
 *
 */
PatternProto.end = function (value: any) {
  const p = reify(value).withValue((v: any) => ({ end: v, endIsDuration: false }));
  return this.set.mix(p);
};

/**
 * Sets the duration of video playback (relative to start, not an absolute end point).
 * Values are relative to video duration by default (0–1). Alias: .dur()
 *
 * @param {number | string | Pattern} value duration as fraction of video length
 * @returns {Pattern} pattern with duration applied
 * @example
 * $: video("clip.mp4").start(0).duration(0.25)  // play first quarter
 * $: video("clip.mp4").dur(0.1)                 // short snippet
 *
 */
PatternProto.duration = function (value: any) {
  const p = reify(value).withValue((v: any) => ({ end: v, endIsDuration: true }));
  return this.set.mix(p);
};
PatternProto.dur = PatternProto.duration;

/**
 * Freezes the video at a given position. Equivalent to .start(value).duration(0).
 *
 * @param {number | string | Pattern} value position to freeze at (0–1 relative, or with .sec()/.ms())
 * @returns {Pattern} pattern frozen at the given position
 * @example
 * $: video("clip.mp4").scrub(0.5)          // freeze at halfway
 * $: video("clip.mp4").scrub(sine)         // slowly scan through the video
 *
 */
PatternProto.scrub = function (value: any) {
  return this.start(value).duration(0);
};

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
 * Sets the horizontal position of the pattern (0–1, where 0 = left edge).
 *
 * @param {number | string | Pattern} value x position
 * @returns {Pattern} pattern with x position applied
 * @example
 * $: color("red").x(0.5).width(0.5)       // right half of screen
 * $: video("clip.mp4").x(sine).width(0.5)  // slides left to right
 *
 */
export const x = createMixParam("x");

/**
 * Sets the vertical position of the pattern (0–1, where 0 = top edge).
 *
 * @param {number | string | Pattern} value y position
 * @returns {Pattern} pattern with y position applied
 * @example
 * $: color("red").y(0.5).height(0.5)       // bottom half of screen
 *
 */
export const y = createMixParam("y");

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

// Helper: compute {x, y, width, height} for cell index i in a cols×rows grid
function cellPos(i: number, cols: number, rows: number) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows };
}

// Helper: resolve first value of a pattern at a given time span, or return number directly
function resolveNum(val: any, begin: any, end: any): number {
  const evs = reify(val).queryArc(begin, end);
  return evs.length ? Math.round(Number(evs[0].value)) : 0;
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
 * @param {number | string | Pattern} i cell index (0-based, left-to-right top-to-bottom). Use mininotation ","
 *   to show in multiple cells simultaneously
 * @param {number | Pattern} cols number of columns
 * @param {number | Pattern} rows number of rows
 * @returns {Pattern} pattern positioned in the grid cell(s)
 * @example
 * $: video("clip.mp4").grid(0, 2, 2)           // top-left of 2×2
 * $: video("clip.mp4").grid(3, 2, 2)           // bottom-right of 2×2
 * $: video("clip.mp4").grid("0 1 2 3", 2, 2)   // cycles through cells
 * $: video("clip.mp4").grid("0,1,2,3", 2, 2)   // all 4 cells at once
 * $: color("red").grid(0, 2, 1).grid(0, 1, 2)  // nested grids
 *
 */
PatternProto.grid = function (i: any, cols: any, rows: any) {
  const self = this;
  const iPat = reify(i);
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const iEvents = iPat.queryArc(begin, end);
    const c = resolveNum(cols, begin, end);
    const r = resolveNum(rows, begin, end);
    const results: any[] = [];
    for (const iEv of iEvents) {
      const idx = Math.round(Number(iEv.value));
      const pos = cellPos(idx, c, r);
      const composed = self.withValue((v: any) =>
        composePos(Object(v) === v ? v : {}, pos)
      );
      results.push(...composed.queryArc(begin, end));
    }
    return results;
  });
};

/**
 * Assigns grid cells to a child pattern by cycling through cells with a stride. Used internally by gridStack()
 * to distribute children across a grid. All arguments can be patterns, resolved at query time.
 *
 * @param {number | Pattern} childIndex this child's index in the list of children
 * @param {number | Pattern} numChildren total number of children (determines stride)
 * @param {number | Pattern} cols number of columns
 * @param {number | Pattern} rows number of rows
 * @returns {Pattern} pattern positioned in its assigned grid cells
 * @example
 * // In a 2×2 grid with 2 children, child 0 gets cells 0,2 and child 1 gets cells 1,3
 * video("a.mp4").gridModulo(0, 2, 2, 2)
 *
 */
PatternProto.gridModulo = function (childIndex: any, numChildren: any, cols: any, rows: any) {
  const self = this;
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const ci = resolveNum(childIndex, begin, end);
    const nc = resolveNum(numChildren, begin, end);
    const c = resolveNum(cols, begin, end);
    const r = resolveNum(rows, begin, end);
    const totalCells = c * r;
    const indices: number[] = [];
    for (let idx = ci; idx < totalCells; idx += nc) {
      indices.push(idx);
    }
    if (indices.length === 0) return [];
    const results: any[] = [];
    for (const idx of indices) {
      const positioned = self.grid(idx, c, r);
      results.push(...positioned.queryArc(begin, end));
    }
    return results;
  });
};
