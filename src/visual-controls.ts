/**
 * Visual controls registered on Pattern.prototype via set.mix (appBoth).
 *
 * Unlike Strudel's default set.in (appLeft), set.mix queries both patterns
 * at the original query state (frame time), so continuous signals like sine
 * get sampled at the exact frame time rather than the event's onset.
 */
import { reify, Pattern } from "@strudel/core";

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

// Helper: resolve first value of a pattern at a given time span, or return number directly
function resolveNum(val: any, begin: any, end: any): number {
  if (typeof val === 'number') return val;
  const evs = reify(val).queryArc(begin, end);
  return evs.length ? Math.round(Number(evs[0].value)) : 0;
}

// .grid(i, cols, rows) — sets x/y/width/height for cell(s) in a cols×rows grid
// All args can be numbers, arrays (for i), or Patterns
PatternProto.grid = function (i: any, cols: any, rows: any) {
  // Fast path: all args are literal numbers
  if (typeof i === 'number' && typeof cols === 'number' && typeof rows === 'number') {
    const pos = cellPos(i, cols, rows);
    return this.x(pos.x).y(pos.y).width(pos.width).height(pos.height);
  }
  // At least one arg is a pattern — resolve all at query time
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
      const positioned = self.grid(idx, c, r);
      results.push(...positioned.queryArc(begin, end));
    }
    return results;
  });
};

// .gridModulo(childIndex, numChildren, cols, rows)
// All args can be numbers or Patterns. At query time: resolves everything,
// computes all cells for this child (cycling), produces one event per cell.
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
