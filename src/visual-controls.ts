/**
 * Visual controls registered on Pattern.prototype via set.mix (appBoth).
 *
 * Unlike Strudel's default set.in (appLeft), set.mix queries both patterns
 * at the original query state (frame time), so continuous signals like sine
 * get sampled at the exact frame time rather than the event's onset.
 */
import { reify, Pattern, stack } from "@strudel/core";

const PatternProto = Object.getPrototypeOf(reify(0));

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

// Shared controls (all screen types)
export const alpha = createMixParam("alpha");
export const opacity = createMixParam("opacity");
export const scaleX = createMixParam("scaleX");
export const scaleY = createMixParam("scaleY");
export const fit = createMixParam("fit");

// scale sets both scaleX and scaleY
PatternProto.scale = function (value: any) {
  return this.scaleX(value).scaleY(value);
};

// Video-specific controls
export const speed = createMixParam("speed");
export const start = createMixParam("start");

// end() sets end value + endIsDuration: false
PatternProto.end = function (value: any) {
  const p = reify(value).withValue((v: any) => ({ end: v, endIsDuration: false }));
  return this.set.mix(p);
};

// duration() sets end value + endIsDuration: true
PatternProto.duration = function (value: any) {
  const p = reify(value).withValue((v: any) => ({ end: v, endIsDuration: true }));
  return this.set.mix(p);
};
PatternProto.dur = PatternProto.duration;

// scrub() sets start + duration(0)
PatternProto.scrub = function (value: any) {
  return this.start(value).duration(0);
};

// URL base control (image/video)
export const urlBase = createMixParam("urlBase");

// Position controls (0–1 relative to canvas)
export const x = createMixParam("x");
export const y = createMixParam("y");
export const width = createMixParam("width");
export const height = createMixParam("height");

// Helper: compute {x, y, width, height} for cell index i in a cols×rows grid
function cellPos(i: number, cols: number, rows: number) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows };
}

// .grid(i, cols, rows) — sets x/y/width/height for cell(s) in a cols×rows grid
// i can be a number, array of numbers, or a Pattern of numbers
PatternProto.grid = function (i: any, cols: number, rows: number) {
  if (Array.isArray(i)) {
    return stack(...i.map((idx: number) => this.grid(idx, cols, rows)));
  }
  if (typeof i === 'number') {
    const pos = cellPos(i, cols, rows);
    return this.x(pos.x).y(pos.y).width(pos.width).height(pos.height);
  }
  // i is a pattern — resolve index at query time, atomically set all 4 position values
  const gridPat = reify(i).withValue((idx: number) => cellPos(Number(idx), cols, rows));
  return this.set.mix(gridPat);
};

// .gridModulo(childIndex, numChildren, colsPat, rowsPat)
// At query time: resolves cols/rows, computes all cells for this child (cycling),
// produces one event per cell with correlated position values.
PatternProto.gridModulo = function (childIndex: number, numChildren: number, cols: any, rows: any) {
  const self = this;
  const colsPat = reify(cols);
  const rowsPat = reify(rows);
  // Use new Pattern to resolve cols/rows at query time
  return new Pattern((state: any) => {
    const { begin, end } = state.span;
    const colEvents = colsPat.queryArc(begin, end);
    const rowEvents = rowsPat.queryArc(begin, end);
    if (!colEvents.length || !rowEvents.length) return [];
    const c = Math.round(Number(colEvents[0].value));
    const r = Math.round(Number(rowEvents[0].value));
    const totalCells = c * r;
    // Build indices for this child
    const indices: number[] = [];
    for (let idx = childIndex; idx < totalCells; idx += numChildren) {
      indices.push(idx);
    }
    if (indices.length === 0) return [];
    // Query self for each index, apply position
    const results: any[] = [];
    for (const idx of indices) {
      const positioned = self.grid(idx, c, r);
      results.push(...positioned.queryArc(begin, end));
    }
    return results;
  });
};
