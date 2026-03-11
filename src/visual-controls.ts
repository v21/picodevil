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
PatternProto.left = PatternProto.x;

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

createMixParam("i");

export const count = createMixParam("count");
export const rows = createMixParam("rows");
export const cols = createMixParam("cols");
createMixParam("radius");
createMixParam("startOffset");
createMixParam("circleCount");

PatternProto.rowscols = function (value: any) {
  return this.rows(value).cols(value);
};

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

function resolveFloat(val: any, begin: any, end: any): number {
  const evs = reify(val).queryArc(begin, end);
  return evs.length ? Number(evs[0].value) : 0;
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
          const r = rowsArg !== undefined ? resolveNum(rowsArg, begin, end) : (val.rows ?? 2);
          const c = colsArg !== undefined ? resolveNum(colsArg, begin, end) : rowsArg !== undefined ? 1 : (val.cols ?? 2);
          return composePos(val, cellPos(iVal, c, r));
        });
        results.push(...positioned.queryArc(begin, end));
      }
      return results;
    }

    // No iArg: read i from each event's value
    return self.withValue((v: any) => {
      const val = Object(v) === v ? v : {};
      const r = rowsArg !== undefined ? resolveNum(rowsArg, begin, end) : (val.rows ?? 2);
      const c = colsArg !== undefined ? resolveNum(colsArg, begin, end) : rowsArg !== undefined ? 1 : (val.cols ?? 2);
      const iVal = val.i ?? 0;
      return composePos(val, cellPos(iVal, c, r));
    }).queryArc(begin, end);
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
/**
 * Like .grid() but cycles this pattern across multiple cells based on i, count, cols, rows.
 * All args optional — reads from event values (.i(), .count(), .rows(), .cols()) if not provided.
 *
 * @param {number | Pattern} rowsArg number of rows (optional)
 * @param {number | Pattern} colsArg number of columns (optional)
 * @example
 * $: stack(video("a.mp4"), video("b.mp4")).indexNow().rowscols(2).gridMod()
 */
PatternProto.gridMod = function (rowsArg?: any, colsArg?: any) {
  const self = this;
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const selfEvs = self.queryArc(begin, end);
    if (selfEvs.length === 0) return [];

    const results: any[] = [];
    for (const ev of selfEvs) {
      const val = Object(ev.value) === ev.value ? ev.value : {};
      const r = rowsArg !== undefined ? resolveNum(rowsArg, begin, end) : (val.rows ?? 2);
      const c = colsArg !== undefined ? resolveNum(colsArg, begin, end) : (val.cols ?? 2);
      const ci = val.i ?? 0;
      const nc = val.count ?? 1;
      const totalCells = r * c;
      for (let idx = ci; idx < totalCells; idx += nc) {
        const pos = cellPos(idx, c, r);
        // Use ev.withValue to preserve Hap structure
        results.push(ev.withValue(() => composePos(val, pos)));
      }
    }
    return results;
  });
};

/**
 * Returns an infinite generator of pattern variants, each transformed by `fn(pattern, index)`.
 * Pass to gridStack() — it will pull exactly cols×rows items at query time.
 *
 * @param {(x: Pattern, i: number) => Pattern} fn transform applied to each copy
 * @example
 * $: gridStack(video("clip.mp4").iteratorWith((x, i) => x.speed(i * 0.5 + 0.5)), 2, 2)
 */
PatternProto.iteratorWith = function (fn: (x: any, i: number) => any): Iterable<any> {
  const self = this;
  return {
    [Symbol.iterator]: function* () {
      let i = 0;
      while (true) yield fn(self, i++);
    }
  };
};

/**
 * Returns an infinite iterable of this pattern (no transformation).
 * Pass to gridStack() to fill all cells with copies of the same pattern.
 *
 * @example
 * $: gridStack(video("clip.mp4").iterator(), 2, 2)
 */
PatternProto.iterator = function (): Iterable<any> {
  return this.iteratorWith((x: any) => x);
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
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    return self.withValue((v: any) => {
      const val = Object(v) === v ? v : {};
      const r = radiusArg !== undefined ? resolveFloat(radiusArg, begin, end) : (val.radius ?? 0.3);
      const so = startOffsetArg !== undefined ? resolveFloat(startOffsetArg, begin, end) : (val.startOffset ?? 0);
      const n = circleCountArg !== undefined ? resolveNum(circleCountArg, begin, end) : (val.circleCount ?? 1);
      const i = iArg !== undefined ? resolveNum(iArg, begin, end) : (val.i ?? 0);
      const size = circleElementSize(n, r);
      const w = val.width ?? size;
      const h = val.height ?? size;
      const pos = circlePos(i, n, r, so, w, h);
      return { ...val, ...pos };
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
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const selfEvs = self.queryArc(begin, end);
    if (selfEvs.length === 0) return [];
    const results: any[] = [];
    for (const ev of selfEvs) {
      const val = Object(ev.value) === ev.value ? ev.value : {};
      const r = radiusArg !== undefined ? resolveFloat(radiusArg, begin, end) : (val.radius ?? 0.3);
      const so = startOffsetArg !== undefined ? resolveFloat(startOffsetArg, begin, end) : (val.startOffset ?? 0);
      const ci = val.i ?? 0;
      const nc = val.count ?? 1;
      const total = circleCountArg !== undefined ? resolveNum(circleCountArg, begin, end) : (val.circleCount ?? nc);
      const size = circleElementSize(total, r);
      const w = val.width ?? size;
      const h = val.height ?? size;
      for (let idx = ci; idx < total; idx += nc) {
        const pos = circlePos(idx, total, r, so, w, h);
        results.push(ev.withValue(() => ({ ...val, ...pos })));
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
      const positioned = self.grid(r, c, idx);
      results.push(...positioned.queryArc(begin, end));
    }
    return results;
  });
};
